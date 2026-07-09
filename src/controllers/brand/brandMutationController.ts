import type { FastifyRequest, FastifyReply } from 'fastify';
import { BrandService } from '../../services/BrandService.ts';

export class BrandMutationController {
  /**
   * POST /api/brands
   */
  static async createBrand(req: FastifyRequest, reply: FastifyReply) {
    try {
      const brandData = req.body as any;

      const brand = await BrandService.createBrand(brandData);

      return reply.status(201).send({
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

  /**
   * PATCH /api/brands/:id
   */
  static async updateBrand(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      const brandData = req.body as any;

      const brand = await BrandService.updateBrand(id, brandData);
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

  /**
   * DELETE /api/brands/:id
   */
  static async deleteBrand(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };

      const success = await BrandService.deleteBrand(id);
      if (!success) {
        return reply.status(404).send({
          success: false,
          message: 'Không tìm thấy thương hiệu để xóa',
        });
      }

      return reply.status(200).send({
        success: true,
        message: 'Đã xóa thương hiệu thành công',
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * POST /api/brands/bulk-delete
   */
  static async bulkDeleteBrands(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { ids } = req.body as { ids: string[] };
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({ success: false, message: 'Danh sách ID không hợp lệ' });
      }

      const success = await BrandService.bulkDeleteBrands(ids);
      if (!success) {
        return reply.status(404).send({
          success: false,
          message: 'Không thể xóa các thương hiệu',
        });
      }

      return reply.status(200).send({
        success: true,
        message: `Đã xóa thành công ${ids.length} thương hiệu`,
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message,
      });
    }
  }
}