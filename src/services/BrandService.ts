import { Brand } from '../models/Brand.ts';
import type { IBrand } from '../models/Brand.ts';
import { ImageService } from './ImageService.ts';


export class BrandService {
  /**
   * Lấy danh sách toàn bộ thương hiệu của tenant (không phân trang)
   */
  static async getAllBrands(): Promise<IBrand[]> {
    return await Brand.find({}).sort({ name: 1 });
  }

  /**
   * Lấy danh sách thương hiệu của tenant với phân trang, lọc
   */
  static async getPaginatedBrands(
    options: { page: number; limit: number; search?: string; origin?: string }
  ): Promise<{ items: IBrand[]; total: number; page: number; totalPages: number }> {
    const { page, limit, search, origin } = options;

    const query: any = {};

    if (search) {
      query.$or = [
        { name: { $regex: '^' + search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { description: { $regex: '^' + search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      ];
    }

    if (origin) {
      query.origin = origin;
    }

    const total = await Brand.countDocuments(query);
    const items = await Brand.find(query)
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return { items, total, page, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Lấy danh sách các xuất xứ duy nhất của thương hiệu
   */
  static async getBrandOrigins(): Promise<string[]> {
    const origins = await Brand.find({ origin: { $ne: null, $exists: true } }).distinct('origin');
    return origins.filter((o): o is string => typeof o === 'string' && o.trim() !== '').sort();
  }

  /**
   * Lấy chi tiết thương hiệu theo ID
   */
  static async getBrandById(id: string): Promise<IBrand | null> {
    return await Brand.findOne({ _id: id });
  }

  /**
   * Tạo thương hiệu mới
   */
  static async createBrand(data: Partial<IBrand>): Promise<IBrand> {
    const brand = new Brand({
      ...data,
    });
    return await brand.save();
  }

  /**
   * Cập nhật thông tin thương hiệu
   */
  static async updateBrand(id: string, data: Partial<IBrand>): Promise<IBrand | null> {
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

  /**
   * Xóa thương hiệu khỏi hệ thống
   */
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

  /**
   * Xóa hàng loạt thương hiệu khỏi hệ thống
   */
  static async bulkDeleteBrands(ids: string[]): Promise<boolean> {
    if (!ids || ids.length === 0) return false;
    
    // Tìm các thương hiệu để lấy danh sách logo cần xóa
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
