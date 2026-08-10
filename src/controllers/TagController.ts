import type { FastifyRequest, FastifyReply } from 'fastify';
import { TagService } from '../services/TagService.ts';

export class TagController {
  /**
   * GET /api/tags
   * Supports pagination when ?page= is provided, otherwise returns full list (backward compat)
   */
  static async getAllTags(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { page, limit, search, status } = req.query as { page?: string; limit?: string; search?: string; status?: string };

      // If page param is provided, use paginated response
      if (page) {
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '25', 10)));
        const result = await TagService.getPaginatedTags(pageNum, limitNum, search ?? '', status);
        return reply.status(200).send({ success: true, data: result });
      }

      // Legacy: return full list
      const tags = await TagService.getAllTags();
      return reply.status(200).send({ success: true, data: tags });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * GET /api/tags/:id
   */
  static async getTagById(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      
      const tag = await TagService.getTagById(id);
      if (!tag) {
        return reply.status(404).send({
          success: false,
          message: 'Không tìm thấy tag này',
        });
      }
      
      return reply.status(200).send({
        success: true,
        data: tag,
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * GET /api/tags/:id/detail
   * Returns tag detail with product count and recent products
   */
  static async getTagDetail(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      
      const tag = await TagService.getTagDetail(id);
      if (!tag) {
        return reply.status(404).send({
          success: false,
          message: 'Không tìm thấy tag này',
        });
      }
      
      return reply.status(200).send({
        success: true,
        data: tag,
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * GET /api/tags/:id/products
   * Returns paginated products of a tag (for "load more")
   */
  static async getTagProducts(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      const { page = '1', limit = '20' } = req.query as { page?: string; limit?: string };

      const data = await TagService.getTagProducts(
        id,
        Math.max(1, parseInt(page, 10) || 1),
        Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
      );

      return reply.status(200).send({
        success: true,
        data,
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * POST /api/tags
   */
  static async createTag(req: FastifyRequest, reply: FastifyReply) {
    try {
      const tagData = req.body as any;
      
      const tag = await TagService.createTag(tagData);
      
      return reply.status(201).send({
        success: true,
        data: tag,
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * PATCH /api/tags/:id
   */
  static async updateTag(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      const tagData = req.body as any;
      
      const tag = await TagService.updateTag(id, tagData);
      if (!tag) {
        return reply.status(404).send({
          success: false,
          message: 'Không tìm thấy tag để cập nhật',
        });
      }
      
      return reply.status(200).send({
        success: true,
        data: tag,
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * DELETE /api/tags/:id
   */
  static async deleteTag(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      
      const success = await TagService.deleteTag(id);
      if (!success) {
        return reply.status(404).send({
          success: false,
          message: 'Không tìm thấy tag để xóa',
        });
      }
      
      return reply.status(200).send({
        success: true,
        message: 'Đã xóa tag thành công',
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * POST /api/tags/bulk-delete
   */
  static async bulkDeleteTags(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { ids } = req.body as { ids: string[] };
      
      if (!ids || ids.length === 0) {
        return reply.status(400).send({
          success: false,
          message: 'Vui lòng cung cấp danh sách ID để xóa.',
        });
      }

      const result = await TagService.bulkDeleteTags(ids);
      
      return reply.status(200).send({
        success: true,
        data: { deletedCount: result },
        message: `Đã xóa ${result} tag thành công.`,
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message,
      });
    }
  }
}