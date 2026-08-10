import type { FastifyRequest, FastifyReply } from 'fastify';
import { BrandService } from '../../services/BrandService.ts';
import { Product } from '../../models/Product.ts';

export class BrandListingController {
  /**
   * GET /api/brands
   * Query params (optional): page, limit, search, origin
   * Không có page/limit → trả về full list (backward compatible)
   */
  static async getAllBrands(req: FastifyRequest, reply: FastifyReply) {
    try {
      const query = req.query as { page?: string; limit?: string; search?: string; origin?: string };

      // Backward compatible: không có page thì trả full list
      if (!query.page) {
        const brands = await BrandService.getAllBrands();
        return reply.status(200).send({ success: true, data: brands });
      }

      const result = await BrandService.getPaginatedBrands({
        page: parseInt(query.page, 10),
        limit: query.limit ? parseInt(query.limit, 10) : 25,
        search: query.search,
        origin: query.origin,
      });

      return reply.status(200).send({ success: true, data: result });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * GET /api/brands/origins
   */
  static async getBrandOrigins(req: FastifyRequest, reply: FastifyReply) {
    try {
      const origins = await BrandService.getBrandOrigins();

      return reply.status(200).send({
        success: true,
        data: origins,
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * GET /api/brands/:id
   */
  static async getBrandById(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };

      const brand = await BrandService.getBrandById(id);
      if (!brand) {
        return reply.status(404).send({
          success: false,
          message: 'Không tìm thấy thương hiệu này',
        });
      }

      // ── Đếm số sản phẩm thuộc thương hiệu ──
      const productCount = await Product.countDocuments({ brandId: id });

      return reply.status(200).send({
        success: true,
        data: { ...brand.toObject(), productCount },
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message,
      });
    }
  }
}