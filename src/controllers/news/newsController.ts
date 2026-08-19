import type { FastifyRequest, FastifyReply } from 'fastify';
import { Article } from '../../models/Article.ts';
import mongoose from 'mongoose';

function generateSlug(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return `${base}-${Date.now().toString(36)}`;
}

export class NewsController {
  /**
   * GET /api/news — Public list of published articles
   */
  static async getPublicArticles(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { category, search, page = '1', limit = '9', featured } = req.query as any;
      const query: any = { isPublished: true };

      if (category && category !== 'ALL') {
        query.category = category;
      }

      if (featured === 'true') {
        query.featured = true;
      }

      if (search && search.trim()) {
        query.$or = [
          { title: { $regex: search.trim(), $options: 'i' } },
          { summary: { $regex: search.trim(), $options: 'i' } },
        ];
      }

      const p = Math.max(1, parseInt(page, 10));
      const l = Math.max(1, parseInt(limit, 10));
      const skip = (p - 1) * l;

      const [articles, total] = await Promise.all([
        Article.find(query)
          .sort({ featured: -1, publishedAt: -1 })
          .skip(skip)
          .limit(l)
          .lean(),
        Article.countDocuments(query),
      ]);

      return reply.send({
        success: true,
        data: {
          articles,
          pagination: {
            page: p,
            limit: l,
            total,
            totalPages: Math.ceil(total / l),
          },
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/news/:slug — Get single article detail & increment views
   */
  static async getArticleBySlug(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { slug } = req.params as { slug: string };
      const article = await Article.findOneAndUpdate(
        { slug, isPublished: true },
        { $inc: { views: 1 } },
        { new: true }
      ).lean();

      if (!article) {
        return reply.status(404).send({ success: false, message: 'Không tìm thấy bài viết' });
      }

      // Get related articles
      const related = await Article.find({
        _id: { $ne: article._id },
        category: article.category,
        isPublished: true,
      })
        .sort({ publishedAt: -1 })
        .limit(3)
        .lean();

      return reply.send({
        success: true,
        data: {
          article,
          related,
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  // ══════════════════════════════════════════
  // ADMIN CONTROLLERS
  // ══════════════════════════════════════════

  /**
   * GET /api/admin/news — Admin article list (includes hidden ones)
   */
  static async getAdminArticles(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { category, search, page = '1', limit = '15', status } = req.query as any;
      const query: any = {};

      if (category && category !== 'ALL') {
        query.category = category;
      }

      if (status === 'published') {
        query.isPublished = true;
      } else if (status === 'hidden') {
        query.isPublished = false;
      }

      if (search && search.trim()) {
        query.$or = [
          { title: { $regex: search.trim(), $options: 'i' } },
          { summary: { $regex: search.trim(), $options: 'i' } },
        ];
      }

      const p = Math.max(1, parseInt(page, 10));
      const l = Math.max(1, parseInt(limit, 10));
      const skip = (p - 1) * l;

      const [articles, total, publishedCount, hiddenCount] = await Promise.all([
        Article.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(l)
          .lean(),
        Article.countDocuments(query),
        Article.countDocuments({ isPublished: true }),
        Article.countDocuments({ isPublished: false }),
      ]);

      return reply.send({
        success: true,
        data: {
          articles,
          stats: {
            total,
            publishedCount,
            hiddenCount,
          },
          pagination: {
            page: p,
            limit: l,
            total,
            totalPages: Math.ceil(total / l),
          },
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/admin/news — Create article
   */
  static async createArticle(req: FastifyRequest, reply: FastifyReply) {
    try {
      const body = req.body as any;
      if (!body.title || !body.summary || !body.content || !body.thumbnail) {
        return reply.status(400).send({ success: false, message: 'Vui lòng nhập đầy đủ thông tin bắt buộc' });
      }

      const slug = body.slug ? body.slug.trim() : generateSlug(body.title);
      const wordCount = body.content.replace(/<[^>]+>/g, '').split(/\s+/).length;
      const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

      const newArticle = await Article.create({
        title: body.title.trim(),
        slug,
        summary: body.summary.trim(),
        content: body.content,
        thumbnail: body.thumbnail,
        category: body.category || 'KIENTHUC',
        tags: Array.isArray(body.tags) ? body.tags : [],
        author: {
          name: body.authorName || "L'essence Editorial",
          avatar: body.authorAvatar || undefined,
        },
        isPublished: body.isPublished !== undefined ? !!body.isPublished : true,
        featured: !!body.featured,
        readingTimeMinutes,
        publishedAt: body.publishedAt ? new Date(body.publishedAt) : new Date(),
      });

      return reply.send({
        success: true,
        message: 'Tạo bài viết tin tức thành công',
        data: newArticle,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /**
   * PUT /api/admin/news/:id — Update article
   */
  static async updateArticle(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      const body = req.body as any;

      const wordCount = body.content ? body.content.replace(/<[^>]+>/g, '').split(/\s+/).length : 0;
      const readingTimeMinutes = wordCount > 0 ? Math.max(1, Math.ceil(wordCount / 200)) : undefined;

      const updated = await Article.findByIdAndUpdate(
        id,
        {
          ...(body.title && { title: body.title.trim() }),
          ...(body.slug && { slug: body.slug.trim() }),
          ...(body.summary && { summary: body.summary.trim() }),
          ...(body.content && { content: body.content }),
          ...(body.thumbnail && { thumbnail: body.thumbnail }),
          ...(body.category && { category: body.category }),
          ...(body.tags && { tags: body.tags }),
          ...(body.authorName && { 'author.name': body.authorName }),
          ...(body.authorAvatar && { 'author.avatar': body.authorAvatar }),
          ...(body.isPublished !== undefined && { isPublished: !!body.isPublished }),
          ...(body.featured !== undefined && { featured: !!body.featured }),
          ...(readingTimeMinutes && { readingTimeMinutes }),
          ...(body.publishedAt && { publishedAt: new Date(body.publishedAt) }),
        },
        { new: true }
      );

      if (!updated) {
        return reply.status(404).send({ success: false, message: 'Không tìm thấy bài viết' });
      }

      return reply.send({
        success: true,
        message: 'Cập nhật bài viết thành công',
        data: updated,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /**
   * PATCH /api/admin/news/:id/toggle-visibility — Toggle published status (Ẩn / Hiện)
   */
  static async toggleVisibility(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      const article = await Article.findById(id);
      if (!article) {
        return reply.status(404).send({ success: false, message: 'Không tìm thấy bài viết' });
      }

      article.isPublished = !article.isPublished;
      await article.save();

      return reply.send({
        success: true,
        message: article.isPublished ? 'Đã hiển thị bài viết' : 'Đã ẩn bài viết',
        data: article,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /**
   * DELETE /api/admin/news/:id — Delete article
   */
  static async deleteArticle(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      const deleted = await Article.findByIdAndDelete(id);
      if (!deleted) {
        return reply.status(404).send({ success: false, message: 'Không tìm thấy bài viết' });
      }

      return reply.send({
        success: true,
        message: 'Xóa bài viết thành công',
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }
}
