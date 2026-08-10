import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { FlashSaleService } from '../services/FlashSaleService.ts';

function isValidObjectId(id: any): boolean {
  return typeof id === 'string' && mongoose.Types.ObjectId.isValid(id);
}

export class FlashSaleController {
  /**
   * GET /api/flash-sales/active
   * Lấy thông tin đợt Flash Sale đang diễn ra (dành cho phía Client)
   */
  static async getActiveFlashSale(req: FastifyRequest, reply: FastifyReply) {
    try {
      const data = await FlashSaleService.getActiveFlashSale();
      return reply.send({
        success: true,
        data,
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message || 'Lỗi lấy thông tin Flash Sale',
      });
    }
  }

  /**
   * GET /api/flash-sales/admin
   * Lấy danh sách đợt Flash Sale cho trang Quản trị
   */
  static async getAdminFlashSales(req: FastifyRequest, reply: FastifyReply) {
    try {
      const query = req.query as { page?: string; limit?: string; status?: string; search?: string };
      const page = parseInt(query.page || '1', 10);
      const limit = parseInt(query.limit || '20', 10);
      const status = query.status;
      const search = query.search;

      const result = await FlashSaleService.getAdminFlashSales({ page, limit, status, search });
      return reply.send({
        success: true,
        data: result.items,
        pagination: result.pagination,
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message || 'Lỗi lấy danh sách Flash Sale admin',
      });
    }
  }

  /**
   * GET /api/flash-sales/admin/:id
   * Chi tiết đợt Flash Sale
   */
  static async getById(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      if (!isValidObjectId(id)) {
        return reply.status(400).send({ success: false, message: 'ID sự kiện Flash Sale không hợp lệ' });
      }
      const data = await FlashSaleService.getById(id);
      if (!data) {
        return reply.status(404).send({ success: false, message: 'Không tìm thấy sự kiện Flash Sale' });
      }
      return reply.send({ success: true, data });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  /**
   * POST /api/flash-sales/admin
   * Tạo sự kiện Flash Sale mới
   */
  static async create(req: FastifyRequest, reply: FastifyReply) {
    try {
      const body = req.body as any;
      const created = await FlashSaleService.create(body);
      return reply.status(201).send({
        success: true,
        message: 'Tạo đợt Flash Sale thành công',
        data: created,
      });
    } catch (error: any) {
      return reply.status(400).send({
        success: false,
        message: error.message || 'Lỗi tạo Flash Sale',
      });
    }
  }

  /**
   * PATCH /api/flash-sales/admin/:id
   * Cập nhật đợt Flash Sale
   */
  static async update(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      if (!isValidObjectId(id)) {
        return reply.status(400).send({ success: false, message: 'ID sự kiện Flash Sale không hợp lệ' });
      }
      const body = req.body as any;
      const updated = await FlashSaleService.update(id, body);
      return reply.send({
        success: true,
        message: 'Cập nhật Flash Sale thành công',
        data: updated,
      });
    } catch (error: any) {
      return reply.status(400).send({
        success: false,
        message: error.message || 'Lỗi cập nhật Flash Sale',
      });
    }
  }

  /**
   * DELETE /api/flash-sales/admin/:id
   * Xóa đợt Flash Sale
   */
  static async delete(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      if (!isValidObjectId(id)) {
        return reply.status(400).send({ success: false, message: 'ID sự kiện Flash Sale không hợp lệ' });
      }
      await FlashSaleService.delete(id);
      return reply.send({
        success: true,
        message: 'Đã xóa sự kiện Flash Sale',
      });
    } catch (error: any) {
      return reply.status(400).send({
        success: false,
        message: error.message || 'Lỗi xóa Flash Sale',
      });
    }
  }

  /**
   * POST /api/flash-sales/assign-product
   * Gán / Gỡ nhanh sản phẩm vào đợt Flash Sale
   */
  static async assignProduct(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { productId, flashSaleId, extraDiscountPercentage, stockLimit } = req.body as any;
      if (!productId) {
        return reply.status(400).send({ success: false, message: 'Thiếu productId' });
      }
      const data = await FlashSaleService.assignProduct(productId, flashSaleId, extraDiscountPercentage, stockLimit);
      return reply.send({
        success: true,
        message: flashSaleId ? 'Đã gán sản phẩm vào sự kiện Flash Sale' : 'Đã gỡ sản phẩm khỏi sự kiện Flash Sale',
        data,
      });
    } catch (error: any) {
      return reply.status(400).send({
        success: false,
        message: error.message || 'Lỗi gán sản phẩm vào Flash Sale',
      });
    }
  }
}
