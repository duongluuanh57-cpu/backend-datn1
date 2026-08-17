import { Brand } from '../models/Brand.ts';
import type { IBrand } from '../models/Brand.ts';
import { Product } from '../models/Product.ts';
import { ImageService } from './ImageService.ts';

export class BrandService {
  /** Lấy danh sách toàn bộ thương hiệu (không phân trang) */
  static async getAllBrands(): Promise<IBrand[]> {
    return await Brand.find({}).sort({ name: 1 });
  }

  /** Lấy danh sách thương hiệu với phân trang, lọc và sắp xếp */
  static async getPaginatedBrands(
    options: { page: number; limit: number; search?: string; origin?: string; sortBy?: string; status?: string }
  ): Promise<{ items: any[]; total: number; page: number; totalPages: number }> {
    const { page, limit, search, origin, sortBy, status } = options;

    const query: any = {};

    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { name: { $regex: safe, $options: 'i' } },
        { description: { $regex: safe, $options: 'i' } },
        { origin: { $regex: safe, $options: 'i' } },
      ];
    }

    if (origin) {
      query.origin = { $regex: origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }

    if (status) {
      query.status = status;
    }

    // Sort
    let sortObj: any = { name: 1 };
    if (sortBy === 'nameAsc') sortObj = { name: 1 };
    else if (sortBy === 'nameDesc') sortObj = { name: -1 };

    const total = await Brand.countDocuments(query);
    const rawItems = await Brand.find(query)
      .sort(sortObj)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Enrich with productCount
    const brandIds = rawItems.map(b => b._id);
    const counts = await Product.aggregate([
      { $match: { brandId: { $in: brandIds } } },
      { $group: { _id: '$brandId', count: { $sum: 1 } } },
    ]);
    const countMap: Record<string, number> = {};
    counts.forEach((c: any) => { countMap[String(c._id)] = c.count; });

    const items = rawItems.map(b => ({ ...b, productCount: countMap[String(b._id)] || 0 }));

    return { items, total, page, totalPages: Math.ceil(total / limit) };
  }

  /** Lấy danh sách xuất xứ duy nhất */
  static async getBrandOrigins(): Promise<string[]> {
    const origins = await Brand.find({ origin: { $ne: null, $exists: true } }).distinct('origin');
    return origins.filter((o): o is string => typeof o === 'string' && o.trim() !== '').sort();
  }

  /** Lấy chi tiết thương hiệu theo ID */
  static async getBrandById(id: string): Promise<IBrand | null> {
    return await Brand.findOne({ _id: id });
  }

  /** Tạo thương hiệu mới */
  static async createBrand(data: Partial<IBrand>): Promise<IBrand> {
    if (data.name) {
      const nameRegex = new RegExp(`^${data.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      const existing = await Brand.findOne({ name: nameRegex });
      if (existing) {
        throw new Error(`Thương hiệu "${data.name.trim()}" đã tồn tại!`);
      }
    }
    const brand = new Brand({ ...data });
    return await brand.save();
  }

  /** Cập nhật thông tin thương hiệu */
  static async updateBrand(id: string, data: Partial<IBrand>): Promise<IBrand | null> {
    if (data.name) {
      const nameRegex = new RegExp(`^${data.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      const existing = await Brand.findOne({ _id: { $ne: id }, name: nameRegex });
      if (existing) {
        throw new Error(`Thương hiệu "${data.name.trim()}" đã tồn tại!`);
      }
    }

    let oldLogo = '';
    if (data.logo) {
      const oldBrand = await Brand.findOne({ _id: id });
      if (oldBrand && oldBrand.logo && oldBrand.logo !== data.logo) {
        oldLogo = oldBrand.logo;
      }
    }

    const updatedBrand = await Brand.findOneAndUpdate(
      { _id: id },
      { $set: data },
      { new: true }
    );

    if (updatedBrand && oldLogo) {
      ImageService.deleteFromR2(oldLogo).catch(err => {
        console.error('Lỗi khi xóa logo cũ thương hiệu khỏi R2:', err);
      });
    }

    return updatedBrand;
  }

  /** Xóa thương hiệu */
  static async deleteBrand(id: string): Promise<boolean> {
    const brand = await Brand.findOne({ _id: id });
    if (!brand) return false;

    const result = await Brand.deleteOne({ _id: id });
    if (result.deletedCount > 0 && brand.logo) {
      ImageService.deleteFromR2(brand.logo).catch(err => {
        console.error('Lỗi khi xóa logo thương hiệu khỏi R2:', err);
      });
    }
    return result.deletedCount > 0;
  }

  /** Xóa hàng loạt thương hiệu */
  static async bulkDeleteBrands(ids: string[]): Promise<boolean> {
    if (!ids || ids.length === 0) return false;

    const brands = await Brand.find({ _id: { $in: ids } });
    const logos = brands.map(b => b.logo).filter(Boolean);

    const result = await Brand.deleteMany({ _id: { $in: ids } });
    if (result.deletedCount > 0 && logos.length > 0) {
      for (const logo of logos) {
        ImageService.deleteFromR2(logo).catch(err => {
          console.error('Lỗi khi xóa logo thương hiệu khỏi R2 trong bulk delete:', err);
        });
      }
    }
    return result.deletedCount > 0;
  }
}
