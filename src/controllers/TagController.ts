import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
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

      if (!mongoose.isValidObjectId(id)) {
        return reply.status(400).send({ success: false, message: 'ID tag không hợp lệ' });
      }

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

      if (!mongoose.isValidObjectId(id)) {
        return reply.status(400).send({ success: false, message: 'ID tag không hợp lệ' });
      }

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

      if (!mongoose.isValidObjectId(id)) {
        return reply.status(400).send({ success: false, message: 'ID tag không hợp lệ' });
      }

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
   * PATCH /api/tags/:id
   * Tag là dữ liệu cố định của web; chỉ cho phép bật/ẩn.
   */
  static async updateTagStatus(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      const body = req.body as { status?: string };
      const status = body?.status;

      if (!mongoose.isValidObjectId(id)) {
        return reply.status(400).send({
          success: false,
          message: 'ID tag không hợp lệ',
        });
      }

      if (status !== 'active' && status !== 'inactive') {
        return reply.status(400).send({
          success: false,
          message: 'Chỉ được cập nhật trạng thái tag thành active hoặc inactive',
        });
      }

      const tag = await TagService.updateTagStatus(id, status);
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

}