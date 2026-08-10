import mongoose from 'mongoose';
import { FlashSale, IFlashSale } from '../models/FlashSale.ts';
import { Product } from '../models/Product.ts';
import { redis } from '../config/redis.ts';
import { formatMultipleProducts } from './product/productFormatterService.ts';

export class FlashSaleService {
  static async clearCache() {
    try {
      const keys = [
        'products:sale:tag:v2',
        'products:new:tag:v5',
        'products:limited:tag:v4',
        'products:trending:tag:v5',
        'homepage:all:v1',
        'homepage:v4',
      ];
      await redis.del(keys);
      // products:public:* (có hash theo filter) cũng chứa dữ liệu Flash Sale
      const publicKeys = await redis.keys('products:public:*');
      if (publicKeys.length > 0) await redis.del(publicKeys);
    } catch (e) {}
  }

  private static toObjectId(id: any): mongoose.Types.ObjectId | null {
    if (!id) return null;
    const str = String(id);
    if (!mongoose.Types.ObjectId.isValid(str)) return null;
    try {
      return new mongoose.Types.ObjectId(str);
    } catch {
      return null;
    }
  }

  private static sanitizeItems(items?: any[]): any[] {
    if (!Array.isArray(items)) return [];
    const result: any[] = [];
    for (const it of items) {
      if (!it || !it.productId) continue;
      const productId = this.toObjectId(it.productId);
      if (!productId) continue;
      result.push({
        productId,
        extraDiscountPercentage: Math.min(100, Math.max(0, Number(it.extraDiscountPercentage) || 0)),
        stockLimit: Math.max(0, Math.round(Number(it.stockLimit) || 0)),
        soldCount: Number.isFinite(it.soldCount) && it.soldCount >= 0 ? Math.round(it.soldCount) : 0,
      });
    }
    return result;
  }

  /**
   * Lấy danh sách ObjectId các sản phẩm đang nằm trong đợt Flash Sale đang diễn ra (Active)
   */
  static async getActiveFlashSaleProductIds(): Promise<mongoose.Types.ObjectId[]> {
    await this.updateStatuses();
    const now = new Date();
    const activeFlashSales = await FlashSale.find({
      status: 'active',
      startDate: { $lte: now },
      endDate: { $gt: now },
    }).select('items.productId').lean();

    const ids: mongoose.Types.ObjectId[] = [];
    for (const fs of activeFlashSales) {
      for (const item of (fs.items || [])) {
        if (item.productId) {
          ids.push(item.productId as any);
        }
      }
    }
    return ids;
  }

  /**
   * Thêm / Xóa / Gán sản phẩm vào đợt Flash Sale
   */
  static async assignProduct(productId: string, flashSaleId: string | null, extraDiscountPercentage = 10, stockLimit = 0) {
    const pObjectId = this.toObjectId(productId);
    if (!pObjectId) throw new Error('productId không hợp lệ');

    let fsIdObject: mongoose.Types.ObjectId | null = null;
    if (flashSaleId) {
      fsIdObject = this.toObjectId(flashSaleId);
      if (!fsIdObject) throw new Error('flashSaleId không hợp lệ');
    }

    const product = await Product.exists({ _id: pObjectId });
    if (!product) throw new Error('Không tìm thấy sản phẩm');

    // 1. Rút sản phẩm khỏi tất cả các đợt Flash Sale hiện tại
    await FlashSale.updateMany(
      { 'items.productId': pObjectId },
      { $pull: { items: { productId: pObjectId } } }
    );

    let assignedFs: IFlashSale | null = null;
    // 2. Nếu có flashSaleId, thêm sản phẩm vào sự kiện Flash Sale được chọn
    if (fsIdObject) {
      const fs = await FlashSale.findById(fsIdObject);
      if (!fs) throw new Error('Không tìm thấy sự kiện Flash Sale được chọn');
      if (fs.items.length >= 20) {
        throw new Error('Mỗi đợt Flash Sale chỉ được chọn tối đa 20 sản phẩm');
      }
      fs.items.push({
        productId: pObjectId as any,
        extraDiscountPercentage: Math.max(0, Math.min(100, Number(extraDiscountPercentage) || 10)),
        stockLimit: Math.max(0, Math.round(Number(stockLimit) || 0)),
        soldCount: 0,
      });
      assignedFs = await fs.save();
    }

    await this.clearCache();
    return assignedFs;
  }

  /**
   * Tính toán trạng thái tự động dựa theo thời gian thực
   */
  static calculateStatus(start: Date, end: Date, requestedStatus?: string): 'scheduled' | 'active' | 'ended' | 'inactive' {
    if (requestedStatus === 'inactive') return 'inactive';
    const now = new Date();
    if (start > now) return 'scheduled';
    if (start <= now && end > now) return 'active';
    return 'ended';
  }

  /**
   * Cập nhật trạng thái tự động của các đợt Flash Sale dựa theo thời gian thực (scheduled <-> active <-> ended)
   */
  static async updateStatuses(): Promise<void> {
    const now = new Date();

    // 1. Chuyển scheduled -> active nếu thời gian hiện tại nằm trong khung giờ [startDate, endDate]
    const scheduledToActive = await FlashSale.updateMany(
      { status: { $nin: ['inactive', 'active'] }, startDate: { $lte: now }, endDate: { $gt: now } },
      { $set: { status: 'active' } }
    );

    // 2. Chuyển active / scheduled -> ended nếu đã qua giờ endDate
    const activeToEnded = await FlashSale.updateMany(
      { status: { $nin: ['inactive', 'ended'] }, endDate: { $lte: now } },
      { $set: { status: 'ended' } }
    );

    // 3. Chuyển ended / active -> scheduled nếu lùi ngày bắt đầu về tương lai
    const futureToScheduled = await FlashSale.updateMany(
      { status: { $nin: ['inactive', 'scheduled'] }, startDate: { $gt: now } },
      { $set: { status: 'scheduled' } }
    );

    if ((scheduledToActive.modifiedCount || 0) > 0 || (activeToEnded.modifiedCount || 0) > 0 || (futureToScheduled.modifiedCount || 0) > 0) {
      await this.clearCache();
    }
  }

  /**
   * Lấy tối đa `limit` (mặc định 3) đợt Flash Sale đang diễn ra (Active) cho phía Khách hàng
   */
  static async getActiveFlashSales(limit = 3): Promise<any[]> {
    await this.updateStatuses();

    const now = new Date();
    let flashSales = await FlashSale.find({
      status: 'active',
      startDate: { $lte: now },
      endDate: { $gt: now },
    })
      .sort({ startDate: -1 })
      .limit(limit)
      .populate({
        path: 'items.productId',
        populate: [
          { path: 'brandId' },
          { path: 'categories' }
        ]
      })
      .lean();

    if (!flashSales || flashSales.length === 0) {
      flashSales = await FlashSale.find({
        status: { $in: ['active', 'scheduled'] }
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate({
          path: 'items.productId',
          populate: [
            { path: 'brandId' },
            { path: 'categories' }
          ]
        })
        .lean();
    }

    if (!flashSales || flashSales.length === 0) return [];

    const rawProducts = flashSales.flatMap((fs: any) =>
      (fs.items || []).map((it: any) => it.productId).filter(Boolean)
    );

    const formattedProducts = rawProducts.length > 0
      ? await formatMultipleProducts(rawProducts)
      : [];

    const productMap = new Map<string, any>(
      formattedProducts.map((p: any) => [p._id.toString(), p])
    );

    return flashSales.map((fs: any) => {
      const formattedItems = (fs.items || [])
        .filter((it: any) => it.productId)
        .map((it: any) => {
          const rawP = it.productId;
          const pId = (rawP._id || rawP).toString();
          const formattedP = productMap.get(pId) || rawP;

          const extra = it.extraDiscountPercentage || 0;
          const baseDiscount = formattedP.discountPercentage || formattedP.discount || 0;
          const totalDiscount = Math.min(100, baseDiscount + extra);

          const rawBasePrice = formattedP.originalPrice || (baseDiscount > 0 ? Math.round((formattedP.price || 0) / (1 - baseDiscount / 100)) : (formattedP.price || 0));
          const flashSalePrice = totalDiscount > 0 ? Math.round(rawBasePrice * (1 - totalDiscount / 100)) : rawBasePrice;

          let tagStr = formattedP.tag || '';

          return {
            ...formattedP,
            tag: tagStr,
            price: flashSalePrice,
            originalPrice: rawBasePrice,
            discount: totalDiscount,
            discountPercentage: totalDiscount,
            isFlashSale: true,
            extraDiscountPercentage: extra,
            stockLimit: it.stockLimit || 0,
            soldCount: it.soldCount || 0,
          };
        });

      return {
        _id: fs._id.toString(),
        name: fs.name,
        startDate: fs.startDate,
        endDate: fs.endDate,
        status: fs.status,
        items: formattedItems,
      };
    });
  }

  /**
   * Lấy đợt Flash Sale đang diễn ra (Active) cho phía Khách hàng
   */
  static async getActiveFlashSale(): Promise<any | null> {
    await this.updateStatuses();

    const now = new Date();
    let flashSale = await FlashSale.findOne({
      status: 'active',
      startDate: { $lte: now },
      endDate: { $gt: now },
    })
      .populate({
        path: 'items.productId',
        populate: [
          { path: 'brandId' },
          { path: 'categories' }
        ]
      })
      .lean();

    // Nếu không có đợt active, lấy đợt sắp diễn ra tiếp theo (scheduled)
    if (!flashSale) {
      flashSale = await FlashSale.findOne({
        status: 'scheduled',
        startDate: { $gt: now },
      })
        .sort({ startDate: 1 })
        .populate({
          path: 'items.productId',
          populate: [
            { path: 'brandId' },
            { path: 'categories' }
          ]
        })
        .lean();
    }

    if (!flashSale) return null;

    // Lọc bỏ các sản phẩm đã bị xóa hoặc không hợp lệ
    const validItems = (flashSale.items || []).filter((item: any) => item.productId != null);

    // Tính giá sale cuối cùng dựa trên variant + discount (khớp với formatMultipleProducts)
    const rawProducts = validItems.map((it: any) => it.productId).filter(Boolean);
    const formattedProducts = rawProducts.length > 0
      ? await formatMultipleProducts(rawProducts)
      : [];
    const productMap = new Map<string, any>(
      formattedProducts.map((p: any) => [p._id.toString(), p])
    );

    const processedItems = validItems.map((item: any) => {
      const rawP = item.productId;
      const pId = (rawP._id || rawP).toString();
      const product = productMap.get(pId) || rawP;

      const baseDiscount = product.discountPercentage || product.discount || 0;
      const extraDiscount = item.extraDiscountPercentage || 0;
      const totalDiscount = Math.min(100, baseDiscount + extraDiscount);
      const originalPrice = product.originalPrice || 0;
      const flashPrice = totalDiscount > 0 && originalPrice > 0
        ? Math.round(originalPrice * (1 - totalDiscount / 100))
        : originalPrice;

      return {
        ...item,
        product,
        baseDiscount,
        extraDiscount,
        totalDiscount,
        originalPrice,
        flashPrice,
        soldPercentage: item.stockLimit > 0 ? Math.min(100, Math.round((item.soldCount / item.stockLimit) * 100)) : 0
      };
    });

    return {
      ...flashSale,
      items: processedItems,
    };
  }

  /**
   * Lấy danh sách Flash Sale cho Admin (phân trang + lọc trạng thái)
   */
  static async getAdminFlashSales(query: { page?: number; limit?: number; status?: string; search?: string }) {
    await this.updateStatuses();

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (query.status && query.status !== 'all') {
      filter.status = query.status;
    }
    if (query.search) {
      const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.name = { $regex: escaped, $options: 'i' };
    }

    const [items, total] = await Promise.all([
      FlashSale.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('items.productId', 'name price image SKU discount')
        .lean(),
      FlashSale.countDocuments(filter),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Lấy chi tiết 1 sự kiện Flash Sale theo ID
   */
  static async getById(id: string) {
    const flashSale = await FlashSale.findById(id).populate('items.productId').lean();
    if (!flashSale) return null;

    const rawProducts = (flashSale.items || [])
      .map((it: any) => it.productId)
      .filter((p: any) => p && p._id);

    const formattedProducts = rawProducts.length > 0
      ? await formatMultipleProducts(rawProducts)
      : [];

    const productMap = new Map<string, any>(
      formattedProducts.map((p: any) => [p._id.toString(), p])
    );

    const formattedItems = (flashSale.items || []).map((it: any) => {
      const p = it.productId;
      if (!p) return it;
      const pId = (p._id || p).toString();
      const fp = productMap.get(pId) || p;
      const baseDiscount = fp.discountPercentage || fp.discount || p.discount || 0;
      const rawOriginalPrice = fp.originalPrice || (baseDiscount > 0 ? Math.round((fp.price || 0) / (1 - baseDiscount / 100)) : (fp.price || 0));

      return {
        ...it,
        productId: {
          _id: pId,
          name: fp.name || p.name || '',
          price: rawOriginalPrice,
          discount: baseDiscount,
          discountPercentage: baseDiscount,
          image: fp.image || p.image || '',
        },
      };
    });

    return {
      ...flashSale,
      items: formattedItems,
    };
  }

  /**
   * Tạo đợt Flash Sale mới
   */
  static async create(data: Partial<IFlashSale>) {
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) {
      throw new Error('Tên sự kiện Flash Sale là bắt buộc');
    }

    const start = new Date(data.startDate as any);
    const end = new Date(data.endDate as any);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error('Thời gian bắt đầu/kết thúc không hợp lệ');
    }
    if (start >= end) {
      throw new Error('Thời gian kết thúc phải sau thời gian bắt đầu');
    }

    const items = this.sanitizeItems(data.items);
    if (items.length > 20) {
      throw new Error('Mỗi đợt Flash Sale chỉ được chọn tối đa 20 sản phẩm');
    }

    const calculatedStatus = this.calculateStatus(start, end, data.status);

    const flashSale = new FlashSale({
      name,
      startDate: start,
      endDate: end,
      status: calculatedStatus,
      items,
    });

    const saved = await flashSale.save();
    await this.clearCache();
    return saved;
  }

  /**
   * Cập nhật thông tin đợt Flash Sale
   */
  static async update(id: string, data: Partial<IFlashSale>) {
    const existing = await FlashSale.findById(id);
    if (!existing) {
      throw new Error('Không tìm thấy sự kiện Flash Sale');
    }

    const name = data.name !== undefined ? (typeof data.name === 'string' ? data.name.trim() : '') : existing.name;
    if (!name) {
      throw new Error('Tên sự kiện Flash Sale là bắt buộc');
    }

    const start = data.startDate ? new Date(data.startDate as any) : existing.startDate;
    const end = data.endDate ? new Date(data.endDate as any) : existing.endDate;
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error('Thời gian bắt đầu/kết thúc không hợp lệ');
    }
    if (start >= end) {
      throw new Error('Thời gian kết thúc phải sau thời gian bắt đầu');
    }

    const items = data.items !== undefined ? this.sanitizeItems(data.items) : existing.items;
    if (items.length > 20) {
      throw new Error('Mỗi đợt Flash Sale chỉ được chọn tối đa 20 sản phẩm');
    }

    existing.name = name;
    existing.startDate = start;
    existing.endDate = end;
    existing.items = items as any;
    existing.status = this.calculateStatus(start, end, data.status);

    const saved = await existing.save();
    await this.clearCache();
    return saved;
  }

  /**
   * Xóa 1 đợt Flash Sale
   */
  static async delete(id: string) {
    const deleted = await FlashSale.findByIdAndDelete(id);
    if (!deleted) {
      throw new Error('Không tìm thấy sự kiện Flash Sale để xóa');
    }
    await this.clearCache();
    return deleted;
  }

  /**
   * Tự động trừ số lượng sale (tăng soldCount) của các sản phẩm Flash Sale đang diễn ra khi người dùng mua hàng
   */
  static async recordFlashSalePurchases(purchases: { productId: string; quantity: number }[]) {
    if (!purchases || purchases.length === 0) return;
    try {
      const now = new Date();
      const activeFlashSales = await FlashSale.find({
        status: 'active',
        startDate: { $lte: now },
        endDate: { $gt: now },
      });

      if (activeFlashSales.length === 0) return;

      let updated = false;
      for (const fs of activeFlashSales) {
        for (const p of purchases) {
          const pIdStr = p.productId?.toString ? p.productId.toString() : String(p.productId);
          const qty = Math.max(1, p.quantity || 1);
          const item = fs.items.find((it: any) => it.productId?.toString() === pIdStr);
          if (!item) continue;

          const stockLimit = item.stockLimit || 0;
          const newSold = stockLimit > 0
            ? Math.min(stockLimit, (item.soldCount || 0) + qty)
            : (item.soldCount || 0) + qty;

          await FlashSale.updateOne(
            { _id: fs._id, 'items.productId': item.productId },
            { $set: { 'items.$.soldCount': newSold } }
          );
          updated = true;
        }
      }

      if (updated) {
        await this.clearCache();
      }
    } catch (err) {
      console.warn('Error updating Flash Sale soldCount:', err);
    }
  }
}

let cronStarted = false;
export function startFlashSaleCron() {
  if (cronStarted) return;
  cronStarted = true;
  setInterval(() => {
    FlashSaleService.updateStatuses().catch((err) => {
      console.warn('Error updating Flash Sale statuses in cron:', err);
    });
  }, 60_000);
}
