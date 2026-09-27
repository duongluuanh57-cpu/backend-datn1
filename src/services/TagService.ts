import mongoose from 'mongoose';
import { Tag } from '../models/Tag.ts';
import type { ITag } from '../models/Tag.ts';
import { ProductTag } from '../models/ProductTag.ts';
import { FlashSaleService } from './FlashSaleService.ts';

export class TagService {
  /**
   * Fetch all tags for the tenant (backward compat — full list)
   */
  static async getAllTags(): Promise<ITag[]> {
    const tags = await Tag.find({ status: 'active' }).sort({ name: 1 });
    return tags;
  }

  /**
   * Fetch paginated tags for admin management
   */
  static async getPaginatedTags(
    page: number = 1,
    limit: number = 25,
    search?: string,
    status?: string
  ): Promise<{ items: any[]; total: number; page: number; totalPages: number }> {
    const query: Record<string, any> = {};
    if (search) {
      query.name = { $regex: '^' + search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }
    if (status) {
      query.status = status;
    }
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      Tag.find(query).sort({ name: 1 }).skip(skip).limit(limit).lean(),
      Tag.countDocuments(query),
    ]);

    const tagIds = items.map((t: any) => t._id);
    let countMap: Record<string, number> = {};
    if (tagIds.length > 0 && mongoose.connection && mongoose.connection.readyState === 1) {
      try {
        const counts = await ProductTag.aggregate([
          { $match: { tagId: { $in: tagIds } } },
          { $group: { _id: '$tagId', count: { $sum: 1 } } },
        ]);
        counts.forEach((c: any) => { countMap[String(c._id)] = c.count; });
      } catch (_) {}
    }

    const itemsWithCounts = items.map((tag: any) => ({
      ...tag,
      productCount: countMap[String(tag._id)] || 0,
    }));

    return { items: itemsWithCounts, total, page, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Fetch details of a tag by ID
   */
  static async getTagById(id: string): Promise<ITag | null> {
    return await Tag.findOne({ _id: id });
  }

  /** Chỉ cập nhật trạng thái hiển thị; không cho phép tạo, sửa danh tính hoặc xóa Tag. */
  static async updateTagStatus(id: string, status: 'active' | 'inactive'): Promise<ITag | null> {
    const updatedTag = await Tag.findOneAndUpdate(
      { _id: id },
      { $set: { status } },
      { new: true }
    );

    if (updatedTag) {
      // Giữ nguyên ProductTag để khi bật lại tag, sản phẩm vẫn giữ liên kết cũ.
      await FlashSaleService.clearCache();
    }

    return updatedTag;
  }

  static async getTagDetail(id: string) {
    const tag = await Tag.findOne({ _id: id }).lean();
    if (!tag) return null;

    const [productCount, recentProductTags] = await Promise.all([
      ProductTag.countDocuments({ tagId: id }),
      ProductTag.find({ tagId: id })
        .populate('productId')
        .sort({ _id: -1 })
        .limit(20)
        .lean(),
    ]);

    const rawProducts = recentProductTags
      .filter((pt: any) => pt.productId)
      .map((pt: any) => pt.productId);

    const { formatMultipleProducts } = await import('./product/productFormatterService.ts');
    const products = await formatMultipleProducts(rawProducts);

    return {
      ...tag,
      productCount,
      products,
    };
  }

  /**
   * Fetch paginated products of a tag (for "load more")
   */
  static async getTagProducts(
    id: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{ items: any[]; total: number; page: number; totalPages: number; hasMore: boolean }> {
    const skip = (page - 1) * limit;
    const [total, productTags] = await Promise.all([
      ProductTag.countDocuments({ tagId: id }),
      ProductTag.find({ tagId: id })
        .populate('productId')
        .sort({ _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const rawProducts = productTags
      .filter((pt: any) => pt.productId)
      .map((pt: any) => pt.productId);

    const { formatMultipleProducts } = await import('./product/productFormatterService.ts');
    const items = await formatMultipleProducts(rawProducts);

    return {
      items,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      hasMore: skip + items.length < total,
    };
  }
}
