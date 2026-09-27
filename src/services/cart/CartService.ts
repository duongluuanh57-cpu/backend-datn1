import { CartItem } from '../../models/CartItem.ts';
import { Product } from '../../models/Product.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { ProductImage } from '../../models/ProductImage.ts';
import { VoucherService } from '../VoucherService.ts';
import { redis } from '../../config/redis.ts';
import { getEffectiveProductDiscount, getEffectiveProductDiscounts } from '../product/productFormatterService.ts';
import { bySizeAsc, parseCapacity } from '../product/productHelpers.ts';
import mongoose from 'mongoose';

/**
 * Trạng thái voucher của giỏ hàng.
 *
 * Giỏ hàng KHÔNG còn document `Cart` để lưu voucher, nên các mã đang áp dụng
 * được client gửi kèm mỗi lần gọi API và server chỉ validate rồi trả lại
 * (stateless). Mức giảm luôn được tính lại từ totalAmount thực tế của cart_items.
 */
export interface VoucherState {
  voucherCode: string | null;
  voucherDiscount: number;
  freeshipVoucherCode: string | null;
}

const EMPTY_VOUCHERS: VoucherState = {
  voucherCode: null,
  voucherDiscount: 0,
  freeshipVoucherCode: null,
};

const toObjectId = (id: string) => new mongoose.Types.ObjectId(id);

/**
 * CartService — giỏ hàng chỉ dùng DUY NHẤT collection `cart_items`.
 *
 * Mỗi document cart_items chỉ lưu { userId, productVariantId, quantity, price }.
 * Tên / ảnh / thương hiệu / dung tích không lưu trữ mà được populate từ
 * ProductVariant → Product (→ Brand) mỗi lần đọc, nên hiển thị luôn theo dữ
 * liệu sản phẩm hiện tại.
 */
export class CartService {
  /**
   * Nhận danh sách cart_items (đã populate productVariantId) và enrich thành
   * shape API cũ: { _id, productId, productVariantId, name, image, brand,
   * price, discount, quantity, variantSize, availableVariants }.
   */
  static async enrichItemsWithVariants(items: any[]) {
    if (!items || items.length === 0) return [];

    const variantOf = (item: any) =>
      item?.productVariantId && typeof item.productVariantId === 'object' ? item.productVariantId : null;
    const productOf = (item: any) => {
      const p = variantOf(item)?.productId;
      return p && typeof p === 'object' ? p : null;
    };

    // Bỏ dòng mồ côi (variant/product đã bị xóa → populate trả null). Nếu không lọc:
    // hiện row trắng, cộng tiền ảo vào total, và productId '' làm sập checkout (C1).
    const validItems = items.filter((item) => variantOf(item) && productOf(item));
    if (validItems.length === 0) return [];

    const productIds = validItems.map((item) => productOf(item)?._id).filter(Boolean);

    const [allVariants, allProductImages, discountMap] = await Promise.all([
      ProductVariant.find({ productId: { $in: productIds } })
        .select('productId size price quantityInStock isDefault')
        .lean()
        .then((vs: any[]) => vs.sort(bySizeAsc)),
      ProductImage.find({ productId: { $in: productIds } })
        .select('url productId')
        .sort({ _id: 1 })
        .lean(),
      getEffectiveProductDiscounts(productIds),
    ]);

    const variantMap: Record<string, any[]> = {};
    allVariants.forEach((v: any) => {
      const pid = String(v.productId);
      if (!variantMap[pid]) variantMap[pid] = [];
      variantMap[pid].push(v);
    });

    const imgMap: Record<string, string> = {};
    allProductImages.forEach((pi: any) => {
      const pid = String(pi.productId);
      if (!imgMap[pid]) imgMap[pid] = pi.url;
    });

    const priceUpdates: Array<{ _id: mongoose.Types.ObjectId; price: number }> = [];

    const enriched = validItems.map((item) => {
      const variant = variantOf(item);
      const product = productOf(item);
      const pid = product ? String(product._id) : '';
      const brand = product?.brandId && typeof product.brandId === 'object' ? product.brandId : null;
      const variants = variantMap[pid] || [];

      let finalImg = imgMap[pid] || product?.image || undefined;
      if (brand?.logo && finalImg === brand.logo) {
        finalImg = imgMap[pid] || undefined;
      }

      const currentDiscount = discountMap.get(pid) || 0;
      const variantBasePrice = variant?.price ?? item.price ?? 0;
      const expectedUnitPrice =
        currentDiscount > 0 ? Math.round(variantBasePrice * (1 - currentDiscount / 100)) : variantBasePrice;

      // Đồng bộ lại đơn giá đã lưu khi giá/khuyến mãi của biến thể thay đổi.
      if (item._id && item.price !== expectedUnitPrice) {
        priceUpdates.push({ _id: item._id, price: expectedUnitPrice });
      }

      return {
        _id: String(item._id),
        productId: pid,
        productVariantId: variant?._id ? String(variant._id) : '',
        name: product?.name || '',
        image: finalImg,
        brand: brand?.name || '',
        price: expectedUnitPrice,
        discount: currentDiscount,
        quantity: item.quantity || 1,
        variantSize: variant?.size || '',
        variantType: variant ? (parseCapacity(variant.size) > 0 && parseCapacity(variant.size) < 50 ? 'decant' : 'fullbox') : undefined,
        availableVariants: variants.map((v: any) => ({
          size: v.size,
          type: parseCapacity(v.size) > 0 && parseCapacity(v.size) < 50 ? 'decant' : 'fullbox',
          price: v.price,
          quantityInStock: v.quantityInStock ?? 0,
          inStock: (v.quantityInStock ?? 0) > 0,
          isDefault: v.isDefault,
        })),
      };
    });

    if (priceUpdates.length > 0) {
      // Một round-trip duy nhất, chờ xong để giá hiển thị khớp với DB.
      try {
        await CartItem.bulkWrite(
          priceUpdates.map((u) => ({
            updateOne: { filter: { _id: u._id }, update: { $set: { price: u.price } } },
          })),
          { ordered: false }
        );
      } catch (err) {
        console.warn('Error syncing cart items price:', err);
      }
    }

    return enriched;
  }

  /** Đọc cart_items của user và populate ProductVariant → Product → Brand. */
  static async loadCartItems(userId: string) {
    const items = await CartItem.find({ userId: toObjectId(userId) })
      .populate({
        path: 'productVariantId',
        select: 'productId size price quantityInStock isDefault',
        populate: {
          path: 'productId',
          select: 'name image brandId',
          populate: { path: 'brandId', select: 'name logo' },
        },
      })
      .sort({ _id: 1 })
      .lean();

    return CartService.enrichItemsWithVariants(items);
  }

  /** Ghép items + tổng tiền + trạng thái voucher thành payload trả cho client. */
  static buildCartResponse(items: any[], vouchers: Partial<VoucherState> = {}) {
    return {
      items,
      totalAmount: items.reduce((sum: number, item: any) => sum + item.price * (item.quantity || 1), 0),
      totalItems: items.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0),
      voucherCode: vouchers.voucherCode ?? null,
      voucherDiscount: vouchers.voucherDiscount ?? 0,
      freeshipVoucherCode: vouchers.freeshipVoucherCode ?? null,
    };
  }

  static async formatCart(userId: string, vouchers: Partial<VoucherState> = {}) {
    const items = await CartService.loadCartItems(userId);
    return CartService.buildCartResponse(items, vouchers);
  }

  static async getCart(userId: string) {
    return await CartService.formatCart(userId, EMPTY_VOUCHERS);
  }

  /**
   * Chọn biến thể để thêm vào giỏ: ưu tiên `variantSize` client gửi lên,
   * nếu không có/không còn hàng thì lấy dung tích lớn nhất còn hàng.
   */
  private static async resolveVariant(productId: string, variantSize?: string) {
    let variantDoc: any = null;
    if (variantSize) {
      variantDoc = await ProductVariant.findOne({
        productId: new mongoose.Types.ObjectId(productId),
        size: variantSize,
      }).lean();
    }

    if (!variantDoc || (variantDoc.quantityInStock !== undefined && variantDoc.quantityInStock <= 0)) {
      const allVariants = await ProductVariant.find({ productId: new mongoose.Types.ObjectId(productId) }).lean();
      if (allVariants.length > 0) {
        const sorted = [...allVariants].sort((a: any, b: any) => parseCapacity(b.size) - parseCapacity(a.size));
        const inStockVariant = sorted.find((v: any) => v.quantityInStock === undefined || v.quantityInStock > 0);
        variantDoc = inStockVariant || sorted[0];
      }
    }

    if (!variantDoc) {
      const err: any = new Error('Biến thể sản phẩm không tồn tại');
      err.statusCode = 400;
      throw err;
    }

    if (variantDoc.quantityInStock !== undefined && variantDoc.quantityInStock <= 0) {
      const err: any = new Error(`Dung tích ${variantDoc.size} đã hết hàng`);
      err.statusCode = 400;
      throw err;
    }

    return variantDoc;
  }

  /** Tính đơn giá sau khuyến mãi của một biến thể. */
  private static async unitPriceOf(productId: string, basePrice: number) {
    const discountPct = await getEffectiveProductDiscount(productId);
    return {
      discount: discountPct,
      price: discountPct > 0 ? Math.round(basePrice * (1 - discountPct / 100)) : basePrice,
    };
  }

  /** Tìm các cart_items của user thuộc một sản phẩm (lọc theo dung tích nếu có). */
  private static async findUserItem(userId: string, productId: string, variantSize?: string) {
    const variants = await ProductVariant.find({ productId: new mongoose.Types.ObjectId(productId) })
      .select('_id size quantityInStock')
      .lean();

    const filter: any = {
      userId: toObjectId(userId),
      productVariantId: { $in: variants.map((v: any) => v._id) },
    };

    if (variantSize) {
      const target = variants.find((v: any) => v.size === variantSize);
      if (!target) return { item: null, variant: null };
      filter.productVariantId = target._id;
    }

    const item = await CartItem.findOne(filter);
    if (!item) return { item: null, variant: null };

    const variant = variants.find((v: any) => String(v._id) === String(item.productVariantId));
    return { item, variant };
  }

  static async addToCart(userId: string, productId: string, quantity: number = 1, variantSize?: string) {
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      const err: any = new Error('ID sản phẩm không hợp lệ');
      err.statusCode = 400;
      throw err;
    }

    const product = await Product.findById(productId)
      .select('name brandId brand image')
      .populate('brandId', 'name logo')
      .lean() as any;
    if (!product) {
      const err: any = new Error('Sản phẩm không tồn tại');
      err.statusCode = 404;
      throw err;
    }

    const variantDoc = await CartService.resolveVariant(productId, variantSize);
    const addQuantity = Math.max(1, Math.floor(quantity || 1));
    const { price: finalPrice } = await CartService.unitPriceOf(productId, variantDoc.price || 0);

    // Một upsert $inc atomic: đã có dòng thì cộng dồn, chưa có thì tạo. Thay cho
    // read-modify-write `.save()` cũ (2 request đồng thời cùng đọc quantity=N rồi cùng
    // ghi N+add → mất một lần cộng). $set price để đơn giá luôn theo giá hiện hành.
    const filter = { userId: toObjectId(userId), productVariantId: variantDoc._id };
    const update = { $inc: { quantity: addQuantity }, $set: { price: finalPrice } };
    try {
      await CartItem.updateOne(filter, update, { upsert: true });
    } catch (err: any) {
      // Hai upsert đồng thời cùng key unique vẫn có thể đụng E11000 (race đã biết của
      // Mongo) → lúc đó dòng đã tồn tại, chỉ cần $inc thường (không upsert) một lần.
      if (err?.code === 11000) {
        await CartItem.updateOne(filter, update);
      } else {
        throw err;
      }
    }

    if (product.brandId) {
      const bid = product.brandId.toString();
      const stage = 'add_to_cart';
      const now = new Date();
      const ds = now.toISOString().split('T')[0];
      const hr = String(now.getHours());
      const totalKey = `funnel:total:${bid}:${stage}`;
      const todayKey = `funnel:daily:${bid}:${stage}:${ds}`;
      const hourKey = `funnel:hourly:${bid}:${stage}:${ds}:${hr}`;
      redis.incr(totalKey).catch(() => {});
      redis.incr(todayKey).catch(() => {});
      redis.expire(todayKey, 172800).catch(() => {});
      redis.incr(hourKey).catch(() => {});
      redis.expire(hourKey, 259200).catch(() => {});
    }

    return await CartService.formatCart(userId);
  }

  static async updateCartItem(userId: string, productId: string, quantity: number, variantSize?: string) {
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      const err: any = new Error('ID sản phẩm không hợp lệ');
      err.statusCode = 400;
      throw err;
    }

    if (quantity < 0) {
      const err: any = new Error('Số lượng không hợp lệ');
      err.statusCode = 400;
      throw err;
    }

    const { item, variant } = await CartService.findUserItem(userId, productId, variantSize);
    if (!item) {
      const err: any = new Error('Sản phẩm không có trong giỏ');
      err.statusCode = 404;
      throw err;
    }

    if (quantity === 0) {
      await CartItem.deleteOne({ _id: item._id });
    } else {
      if (variant && variant.quantityInStock !== undefined && quantity > variant.quantityInStock) {
        const err: any = new Error(`Quá số lượng tồn kho, sản phẩm này hiện có ${variant.quantityInStock} sản phẩm`);
        err.statusCode = 400;
        throw err;
      }
      item.quantity = quantity;
      await item.save();
    }

    return await CartService.formatCart(userId);
  }

  static async updateCartItemVariant(
    userId: string,
    productId: string,
    newVariantSize: string,
    currentVariantSize?: string
  ) {
    if (!productId || !newVariantSize || !mongoose.Types.ObjectId.isValid(productId)) {
      const err: any = new Error('Dữ liệu không hợp lệ');
      err.statusCode = 400;
      throw err;
    }

    const newVariant = await ProductVariant.findOne({
      productId: new mongoose.Types.ObjectId(productId),
      size: newVariantSize,
    }).lean();
    if (!newVariant) {
      const err: any = new Error('Biến thể không tồn tại');
      err.statusCode = 404;
      throw err;
    }

    const { item } = await CartService.findUserItem(userId, productId, currentVariantSize);
    if (!item) {
      const err: any = new Error('Sản phẩm không có trong giỏ');
      err.statusCode = 404;
      throw err;
    }

    const { price: finalPrice } = await CartService.unitPriceOf(productId, newVariant.price || 0);

    const existingWithNewVariant = await CartItem.findOne({
      userId: toObjectId(userId),
      productVariantId: newVariant._id,
      _id: { $ne: item._id },
    });

    const newStock = newVariant.quantityInStock !== undefined ? newVariant.quantityInStock : 999;
    const adjustedQuantity = Math.max(1, Math.min(item.quantity, newStock));

    if (existingWithNewVariant) {
      existingWithNewVariant.quantity = Math.min(existingWithNewVariant.quantity + adjustedQuantity, newStock);
      existingWithNewVariant.price = finalPrice;
      await existingWithNewVariant.save();
      await CartItem.deleteOne({ _id: item._id });
    } else {
      item.productVariantId = newVariant._id;
      item.price = finalPrice;
      item.quantity = adjustedQuantity;
      await item.save();
    }

    return await CartService.formatCart(userId);
  }

  static async removeCartItem(userId: string, productId: string, variantSize?: string) {
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      const err: any = new Error('ID sản phẩm không hợp lệ');
      err.statusCode = 400;
      throw err;
    }

    // Có variantSize → xóa đúng dòng của biến thể đó. Không có → xóa MỌI dòng của
    // product (đúng ý "xóa sản phẩm khỏi giỏ"), thay vì chỉ một dòng tùy ý như
    // findUserItem().findOne cũ (product nhiều size trong giỏ sẽ bị xóa thiếu).
    const variants = await ProductVariant.find({ productId: toObjectId(productId) })
      .select('_id size')
      .lean();
    const targetIds = variantSize
      ? (variants.filter((v: any) => v.size === variantSize).map((v: any) => v._id))
      : variants.map((v: any) => v._id);

    const res = await CartItem.deleteMany({
      userId: toObjectId(userId),
      productVariantId: { $in: targetIds },
    });
    if (res.deletedCount === 0) {
      const err: any = new Error('Sản phẩm không có trong giỏ');
      err.statusCode = 404;
      throw err;
    }

    return await CartService.formatCart(userId);
  }

  static async clearCart(userId: string) {
    await CartItem.deleteMany({ userId: toObjectId(userId) });
    return CartService.buildCartResponse([], EMPTY_VOUCHERS);
  }

  static async listAvailableVouchers(userId: string) {
    const items = await CartService.loadCartItems(userId);
    const totalAmount = items.reduce((sum: number, item: any) => sum + item.price * (item.quantity || 1), 0);

    const vouchers = await VoucherService.getActive();

    return vouchers
      .filter((v: any) => {
        if (totalAmount < v.minOrderAmount) return false;
        if ((v.usedCount || 0) >= v.maxUsage) return false;
        return true;
      })
      .map((v: any) => {
        let discountAmount = 0;
        if (v.type === 'percentage') {
          discountAmount = Math.round(totalAmount * (v.value / 100));
          if (v.maxDiscount && discountAmount > v.maxDiscount) {
            discountAmount = v.maxDiscount;
          }
        } else {
          discountAmount = v.value;
        }
        const remaining = Math.max(0, v.maxUsage - (v.usedCount || 0));
        return {
          code: v.code,
          type: v.type,
          value: v.value,
          maxDiscount: v.maxDiscount || null,
          minOrderAmount: v.minOrderAmount,
          discountAmount,
          endDate: v.endDate,
          remaining,
          maxUsage: v.maxUsage,
          usedCount: v.usedCount,
        };
      });
  }

  /**
   * Validate mã giảm giá rồi trả về giỏ hàng kèm mức giảm mới.
   * Không ghi gì vào DB: voucher là state phía client (xem `VoucherState`).
   */
  static async applyVoucher(userId: string, code: string, current: Partial<VoucherState> = {}) {
    if (!code) {
      const err: any = new Error('Vui lòng nhập mã giảm giá');
      err.statusCode = 400;
      throw err;
    }

    const items = await CartService.loadCartItems(userId);
    if (items.length === 0) {
      return { success: false, message: 'Giỏ hàng trống' };
    }

    const totalAmount = items.reduce((sum: number, item: any) => sum + item.price * (item.quantity || 1), 0);

    const result = await VoucherService.validate(code, totalAmount);
    if (!result.valid) {
      return { success: false, message: result.message };
    }

    const voucher = result.voucher!;
    const discountAmount = result.discountAmount!;

    const isFreeship =
      voucher.voucherCategory === 'freeship' ||
      voucher.code.startsWith('FSEXPRESS') ||
      (voucher.type === 'fixed' && voucher.value === 0);

    const vouchers: VoucherState = {
      voucherCode: current.voucherCode ?? null,
      voucherDiscount: current.voucherDiscount ?? 0,
      freeshipVoucherCode: current.freeshipVoucherCode ?? null,
    };

    if (isFreeship) {
      vouchers.freeshipVoucherCode = voucher.code;
    } else {
      vouchers.voucherCode = voucher.code;
      vouchers.voucherDiscount = discountAmount;
    }

    return {
      success: true,
      message: `Áp dụng mã ${voucher.code} thành công!`,
      data: CartService.buildCartResponse(items, vouchers),
    };
  }

  static async removeVoucher(
    userId: string,
    code?: string,
    type?: 'discount' | 'freeship',
    current: Partial<VoucherState> = {}
  ) {
    const vouchers: VoucherState = {
      voucherCode: current.voucherCode ?? null,
      voucherDiscount: current.voucherDiscount ?? 0,
      freeshipVoucherCode: current.freeshipVoucherCode ?? null,
    };

    if (code) {
      if (vouchers.voucherCode === code) {
        vouchers.voucherCode = null;
        vouchers.voucherDiscount = 0;
      } else if (vouchers.freeshipVoucherCode === code) {
        vouchers.freeshipVoucherCode = null;
      }
    } else if (type === 'discount') {
      vouchers.voucherCode = null;
      vouchers.voucherDiscount = 0;
    } else if (type === 'freeship') {
      vouchers.freeshipVoucherCode = null;
    } else {
      vouchers.voucherCode = null;
      vouchers.voucherDiscount = 0;
      vouchers.freeshipVoucherCode = null;
    }

    return {
      success: true,
      message: 'Đã hủy mã giảm giá',
      data: await CartService.formatCart(userId, vouchers),
    };
  }
}
