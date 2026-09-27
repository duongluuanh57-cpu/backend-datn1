import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { BrandService } from '../../services/BrandService.ts';

export class BrandMutationController {
  /**
   * PATCH /api/brands/:id
   * Brand là dữ liệu mặc định của web; chỉ cho phép bật/ẩn.
   */
  static async updateBrandStatus(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      const body = req.body as { status?: string };
      const status = body?.status;

      if (!mongoose.isValidObjectId(id)) {
        return reply.status(400).send({
          success: false,
          message: 'ID thương hiệu không hợp lệ',
        });
      }

      if (status !== 'active' && status !== 'inactive') {
        return reply.status(400).send({
          success: false,
          message: 'Chỉ được cập nhật trạng thái thương hiệu thành active hoặc inactive',
        });
      }

      const brand = await BrandService.updateBrandStatus(id, status);
      if (!brand) {
        return reply.status(404).send({
          success: false,
          message: 'Không tìm thấy thương hiệu để cập nhật',
        });
      }

      return reply.status(200).send({
        success: true,
        data: brand,
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message,
      });
    }
  }
}
