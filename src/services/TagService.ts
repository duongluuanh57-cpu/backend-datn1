import mongoose from 'mongoose';
import { Tag } from '../models/Tag.ts';
import type { ITag } from '../models/Tag.ts';
import { ProductTag } from '../models/ProductTag.ts';
import { slugify } from '../utils/textNormalizer.ts';
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

  /**
   * Create a new tag
   */
  static async createTag(data: Partial<ITag>): Promise<ITag> {
    const slug = data.slug || slugify(data.name || '');
    const tag = new Tag({
      ...data,
      slug,
    });
    return await tag.save();
  }

  /**
   * Update tag info
   */
  static async updateTag(id: string, data: Partial<ITag>): Promise<ITag | null> {
    const updateData = { ...data };
    if (data.name && !data.slug) {
      updateData.slug = slugify(data.name);
    }
    const updatedTag = await Tag.findOneAndUpdate(
      { _id: id },
      { $set: updateData },
      { new: true }
    );

    // Nếu Tag chuyển sang trạng thái Ẩn (inactive), tự động gỡ Tag khỏi tất cả sản phẩm
    if (data.status === 'inactive') {
      await ProductTag.deleteMany({ tagId: id });
    }
    await FlashSaleService.clearCache();

    return updatedTag;
  }

  /**
   * Delete tag from the system
   */
  static async deleteTag(id: string): Promise<boolean> {
    const result = await Tag.deleteOne({ _id: id });
    if (mongoose.Types.ObjectId.isValid(id)) {
      await ProductTag.deleteMany({ tagId: new mongoose.Types.ObjectId(id) });
    }
    await FlashSaleService.clearCache();
    return result.deletedCount > 0;
  }

  static async bulkDeleteTags(ids: string[]): Promise<number> {
    if (!ids || ids.length === 0) return 0;
    const result = await Tag.deleteMany({ _id: { $in: ids } });
    const validObjectIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id));
    if (validObjectIds.length > 0) {
      await ProductTag.deleteMany({ tagId: { $in: validObjectIds } });
    }
    await FlashSaleService.clearCache();
    return result.deletedCount;
  }

  static async getTagDetail(id: string) {
    const tag = await Tag.findOne({ _id: id }).lean();
    if (!tag) return null;

    const [productCount, recentProductTags] = await Promise.all([
      ProductTag.countDocuments({ tagId: id }),
      ProductTag.find({ tagId: id })
        .populate('productId')
        .sort({ createdAt: -1 })
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
        .sort({ createdAt: -1 })
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
