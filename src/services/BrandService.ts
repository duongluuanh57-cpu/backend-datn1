import { Brand } from '../models/Brand.ts';
import type { IBrand } from '../models/Brand.ts';
import { Product } from '../models/Product.ts';
import { redis } from '../config/redis.ts';

export class BrandService {
  /** Lấy danh sách brand đang hoạt động cho storefront/AI (không phân trang, có cache) */
  static async getAllBrands(): Promise<IBrand[]> {
    const cacheKey = 'brands:all:active:v1';
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (_) {}

    const brands = await Brand.find({ status: 'active' }).sort({ name: 1 });
    if (brands && (brands as any[]).length > 0) {
      try {
        await redis.set(cacheKey, JSON.stringify(brands), 'EX', 300);
      } catch (_) {}
    }
    return brands as any;
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

  /** Lấy chi tiết thương hiệu theo ID */
  static async getBrandById(id: string): Promise<IBrand | null> {
    return await Brand.findOne({ _id: id });
  }

  /** Chỉ cập nhật trạng thái hiển thị của brand; không cho phép sửa danh tính brand. */
  static async updateBrandStatus(id: string, status: 'active' | 'inactive'): Promise<IBrand | null> {
    const updatedBrand = await Brand.findOneAndUpdate(
      { _id: id },
      { $set: { status } },
      { new: true }
    );

    if (updatedBrand) {
      try {
        // Xóa cache danh sách brand + toàn bộ cache trang chủ theo pattern
        // (version key trang chủ hay đổi nên quét `homepage:*` cho chắc).
        const keysToDelete = ['brands:all', 'brands:all:active:v1'];
        let cursor = '0';
        do {
          const [next, keys] = await redis.scan(cursor, 'MATCH', 'homepage:*', 'COUNT', 200);
          cursor = next;
          if (keys.length > 0) keysToDelete.push(...keys);
        } while (cursor !== '0');
        if (keysToDelete.length > 0) await redis.del(...keysToDelete);
        // Trang chủ còn 1 tầng cache in-memory trong graphql/schema → phải hủy cả hai.
        const { invalidateHomepageCache } = await import('../graphql/schema.ts');
        invalidateHomepageCache();
      } catch (_) {}
    }

    return updatedBrand;
  }
}
