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
    search?: string
  ): Promise<{ items: ITag[]; total: number; page: number; totalPages: number }> {
    const query: Record<string, any> = {};
    if (search) {
      query.name = { $regex: '^' + search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      Tag.find(query).sort({ name: 1 }).skip(skip).limit(limit).lean(),
      Tag.countDocuments(query),
    ]);
    return { items: items as unknown as ITag[], total, page, totalPages: Math.ceil(total / limit) };
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
    await ProductTag.deleteMany({ tagId: id });
    await FlashSaleService.clearCache();
    return result.deletedCount > 0;
  }

  static async bulkDeleteTags(ids: string[]): Promise<number> {
    if (!ids || ids.length === 0) return 0;
    const result = await Tag.deleteMany({ _id: { $in: ids } });
    await ProductTag.deleteMany({ tagId: { $in: ids } });
    await FlashSaleService.clearCache();
    return result.deletedCount;
  }

  static async getTagDetail(id: string) {
    const tag = await Tag.findOne({ _id: id }).lean();
    if (!tag) return null;

    const [productCount, recentProductTags] = await Promise.all([
      ProductTag.countDocuments({ tagId: id }),
      ProductTag.find({ tagId: id })
        .populate('productId', 'name slug price images status')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ]);

    const products = recentProductTags
      .filter((pt: any) => pt.productId)
      .map((pt: any) => ({
        _id: pt.productId._id,
        name: pt.productId.name,
        slug: pt.productId.slug,
        price: pt.productId.price,
        image: pt.productId.images?.[0] || '',
        status: pt.productId.status,
      }));

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
        .populate('productId', 'name slug price images status')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const items = productTags
      .filter((pt: any) => pt.productId)
      .map((pt: any) => ({
        _id: pt.productId._id,
        name: pt.productId.name,
        slug: pt.productId.slug,
        price: pt.productId.price,
        image: pt.productId.images?.[0] || '',
        status: pt.productId.status,
      }));

    return {
      items,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      hasMore: skip + items.length < total,
    };
  }
}
