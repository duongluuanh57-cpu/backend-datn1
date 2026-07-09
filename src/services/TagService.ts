import { Tag } from '../models/Tag.ts';
import type { ITag } from '../models/Tag.ts';

function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

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
    return await Tag.findOneAndUpdate(
      { _id: id },
      { $set: updateData },
      { new: true }
    );
  }

  /**
   * Delete tag from the system
   */
  static async deleteTag(id: string): Promise<boolean> {
    const result = await Tag.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }

  static async bulkDeleteTags(ids: string[]): Promise<number> {
    if (!ids || ids.length === 0) return 0;
    const result = await Tag.deleteMany({ _id: { $in: ids } });
    return result.deletedCount;
  }
}
