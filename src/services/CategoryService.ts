import { Category } from '../models/Category.ts';
import { Product } from '../models/Product.ts';
import { slugify } from '../utils/textNormalizer.ts';
import { redis } from '../config/redis.ts';

export class CategoryService {
  static async getAll(): Promise<any[]> {
    const cacheKey = 'categories:all';
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (_) {}

    const categories = await Category.find({}).sort({ name: 1 }).lean();
    if (categories.length > 0) {
      try {
        await redis.set(cacheKey, JSON.stringify(categories), 'EX', 300);
      } catch (_) {}
    }
    return categories;
  }

  static async getPaginatedCategories(
    options: { page: number; limit: number; search?: string; status?: string }
  ): Promise<{ items: any[]; total: number; page: number; totalPages: number }> {
    const { page, limit, search, status } = options;
    const query: any = {};

    if (search) {
      query.name = { $regex: '^' + search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }

    if (status) {
      query.status = status;
    }

    const [items, total] = await Promise.all([
      Category.find(query)
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Category.countDocuments(query),
    ]);

    const catIds = items.map((c: any) => c._id);
    let countMap: Record<string, number> = {};
    if (catIds.length > 0) {
      try {
        const counts = await Product.aggregate([
          { $match: { categoryId: { $in: catIds } } },
          { $group: { _id: '$categoryId', count: { $sum: 1 } } },
        ]);
        counts.forEach((c: any) => { countMap[String(c._id)] = c.count; });
      } catch (_) {}
    }

    const itemsWithCounts = items.map((cat: any) => ({
      ...cat,
      productCount: countMap[String(cat._id)] || 0,
    }));

    return { items: itemsWithCounts, total, page, totalPages: Math.ceil(total / limit) };
  }

  static async getById(id: string): Promise<any | null> {
    const category = await Category.findOne({ _id: id }).lean();
    if (!category) return null;
    let productCount = 0;
    try {
      productCount = await Product.countDocuments({ categoryId: id });
    } catch (_) {}
    return { ...category, productCount };
  }

  /** Slug có unique index → kiểm tra trước để trả lỗi thân thiện thay vì E11000/500. */
  private static async assertSlugAvailable(slug: string, excludeId?: string): Promise<void> {
    const existing = await Category.findOne(
      excludeId ? { slug, _id: { $ne: excludeId } } : { slug }
    ).lean();
    if (existing) {
      const err: any = new Error(`Slug "${slug}" đã tồn tại. Vui lòng chọn slug khác.`);
      err.statusCode = 409;
      throw err;
    }
  }

  static async create(data: { name: string; slug?: string; status?: string }): Promise<any> {
    // Tôn trọng slug tùy chỉnh từ client; nếu trống thì dẫn xuất từ tên.
    const slug = slugify((data.slug && data.slug.trim()) || data.name);
    await this.assertSlugAvailable(slug);
    const category = new Category({
      name: data.name,
      slug,
      status: data.status || 'active',
    });
    const saved = await category.save();
    try { await redis.del('categories:all'); } catch (_) {}
    return saved;
  }

  static async update(id: string, data: { name?: string; slug?: string; status?: string }): Promise<any | null> {
    const updateData: any = {};
    if (data.name !== undefined) {
      updateData.name = data.name;
    }
    if (data.slug !== undefined && data.slug.trim()) {
      updateData.slug = slugify(data.slug.trim());
    } else if (data.name !== undefined) {
      updateData.slug = slugify(data.name);
    }
    if (data.status !== undefined) updateData.status = data.status;
    if (updateData.slug) await this.assertSlugAvailable(updateData.slug, id);
    const updated = await Category.findOneAndUpdate({ _id: id }, { $set: updateData }, { new: true }).lean();
    try { await redis.del('categories:all'); } catch (_) {}
    return updated;
  }

  static async delete(id: string): Promise<boolean> {
    const productCount = await Product.countDocuments({ categoryId: id });
    if (productCount > 0) {
      const err: any = new Error(`Không thể xoá category vì có ${productCount} sản phẩm đang sử dụng.`);
      err.statusCode = 409;
      throw err;
    }
    const result = await Category.deleteOne({ _id: id });
    try { await redis.del('categories:all'); } catch (_) {}
    return result.deletedCount > 0;
  }
}
