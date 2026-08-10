import { Category } from '../models/Category.ts';
import { Product } from '../models/Product.ts';
import { slugify } from '../utils/textNormalizer.ts';

export class CategoryService {
  static async getAll(): Promise<any[]> {
    return Category.find({}).sort({ name: 1 }).lean();
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

    const total = await Category.countDocuments(query);
    const items = await Category.find(query)
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const itemsWithCounts = await Promise.all(
      items.map(async (cat: any) => {
        const productCount = await Product.countDocuments({ categoryId: cat._id });
        return { ...cat, productCount };
      })
    );

    return { items: itemsWithCounts, total, page, totalPages: Math.ceil(total / limit) };
  }

  static async getById(id: string): Promise<any | null> {
    return Category.findOne({ _id: id }).lean();
  }

  static async create(data: { name: string; status?: string }): Promise<any> {
    const slug = slugify(data.name);
    const category = new Category({
      name: data.name,
      slug,
      status: data.status || 'active',
    });
    return category.save();
  }

  static async update(id: string, data: { name?: string; status?: string }): Promise<any | null> {
    const updateData: any = {};
    if (data.name !== undefined) {
      updateData.name = data.name;
      updateData.slug = slugify(data.name);
    }
    if (data.status !== undefined) updateData.status = data.status;
    return Category.findOneAndUpdate({ _id: id }, { $set: updateData }, { new: true }).lean();
  }

  static async delete(id: string): Promise<boolean> {
    const productCount = await Product.countDocuments({ categoryId: id });
    if (productCount > 0) {
      throw new Error(`Không thể xoá category vì có ${productCount} sản phẩm đang sử dụng.`);
    }
    const result = await Category.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }

  static async bulkDelete(ids: string[]): Promise<boolean> {
    if (!ids || ids.length === 0) return false;

    const productUsing = await Product.countDocuments({ categoryId: { $in: ids } });
    if (productUsing > 0) {
      throw new Error(`Không thể xoá ${productUsing} danh mục vì có sản phẩm đang sử dụng.`);
    }

    const result = await Category.deleteMany({ _id: { $in: ids } });
    return result.deletedCount > 0;
  }
}
