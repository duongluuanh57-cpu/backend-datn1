import { Content } from '../models/Content.ts';

export class ContentSearchService {
  static async search(keyword: string, limit = 5) {
    if (!keyword?.trim()) return [];

    return Content.find(
      { $text: { $search: keyword } },
      { score: { $meta: 'textScore' } }
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit)
      .lean();
  }

  static async searchWithPagination(
    keyword: string,
    page = 1,
    pageSize = 10
  ) {
    if (!keyword?.trim()) return { items: [], total: 0, page, totalPages: 0 };

    const query = { $text: { $search: keyword } };
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      Content.find(query, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' } })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      Content.countDocuments(query),
    ]);

    return {
      items,
      total,
      page,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}
