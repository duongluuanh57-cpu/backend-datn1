import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { BrandService } from '../../services/BrandService.ts';
import { Product } from '../../models/Product.ts';

export class BrandListingController {
  /**
   * GET /api/brands
   * Query params (optional): page, limit, search, origin, sortBy
   * Không có page → trả full list (backward compatible)
   */
  static async getAllBrands(req: FastifyRequest, reply: FastifyReply) {
    try {
      const query = req.query as { page?: string; limit?: string; search?: string; origin?: string; sortBy?: string; status?: string };

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
        sortBy: query.sortBy,
        status: query.status,
      });

      return reply.status(200).send({ success: true, data: result });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  /**
   * GET /api/brands/:id
   */
  static async getBrandById(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };

      if (!mongoose.isValidObjectId(id)) {
        return reply.status(400).send({ success: false, message: 'ID thương hiệu không hợp lệ' });
      }

      const brand = await BrandService.getBrandById(id);
      if (!brand) {
        return reply.status(404).send({ success: false, message: 'Không tìm thấy thương hiệu này' });
      }

      const productCount = await Product.countDocuments({ brandId: id });

      return reply.status(200).send({
        success: true,
        data: { ...brand.toObject(), productCount },
      });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }
}