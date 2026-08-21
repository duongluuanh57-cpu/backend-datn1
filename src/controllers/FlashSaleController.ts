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

  /**
   * GET /api/flash-sales/suggest-name
   * AI đề xuất tên sự kiện Flash Sale theo thời gian, ngày lễ hoặc từ khóa
   */
  static async suggestName(req: FastifyRequest, reply: FastifyReply) {
    try {
      const query = req.query as { date?: string; keyword?: string };
      const dateStr = query.date || new Date().toISOString();
      const keyword = query.keyword || '';

      const { getGeminiClient, PRIMARY_MODEL } = await import('../services/ai/aiClient.ts');
      
      const targetDate = new Date(dateStr);
      const day = targetDate.getDate();
      const month = targetDate.getMonth() + 1;
      const year = targetDate.getFullYear();

      const prompt = `Bạn là chuyên gia Marketing E-commerce cho sàn thương mại điện tử chuyên về nước hoa cao cấp L'Essence (phong cách Shopee / Lazada / TikTok Shop).
Nhiệm vụ: Hãy đề xuất 4 đến 6 tên sự kiện Flash Sale cực kỳ hấp dẫn, bắt mắt, đúng chất giờ vàng săn sale.
Thông tin tham khảo:
- Thời gian tổ chức: Ngày ${day}/${month}/${year} (Hãy kiểm tra xem có ngày đôi như ${day}.${month}, đầu tháng lương về, cuối tháng xả kho, lễ 8/3, 14/2, 30/4, 2/9, Trung thu, Black Friday, Giáng sinh, Tết... hoặc khung giờ vàng nào không).
${keyword ? `- Người dùng đang gõ từ khóa: "${keyword}" (Hãy ưu tiên gợi ý phù hợp với từ khóa này)` : ''}

Yêu cầu định dạng đầu ra: Trả về JSON thuần (không markdown) dạng danh sách:
{
  "suggestions": [
    {
      "title": "Tên sự kiện ngắn gọn, giật tít hấp dẫn (Ví dụ: Đại Tiệc Siêu Sale 9.9 - Deal Nước Hoa 0Đ)",
      "badge": "Tag nổi bật (VD: Siêu Sale / Lương Về / Khung Giờ Vàng / Ngày Đôi)",
      "description": "Mô tả ngắn gọn lý do hấp dẫn"
    }
  ]
}`;

      try {
        const client = getGeminiClient();
        const model = client.getGenerativeModel({
          model: PRIMARY_MODEL,
          generationConfig: { responseMimeType: 'application/json' }
        });
        const res = await model.generateContent(prompt);
        const text = res.response.text();
        const parsed = JSON.parse(text);
        return reply.send({
          success: true,
          data: parsed.suggestions || [],
        });
      } catch (aiErr) {
        // Fallback thông minh nếu AI bận
        const fallback = [
          {
            title: `Flash Sale Giờ Vàng ${day}.${month} - Săn Deal Nước Hoa Hàng Hiệu`,
            badge: `Siêu Sale ${day}.${month}`,
            description: `Khuyến mãi khung giờ vàng ngày ${day}/${month}`,
          },
          {
            title: `Sale Lương Về - Nước Hoa Chính Hãng Giảm Đến 50%`,
            badge: 'Lương Về',
            description: 'Đại tiệc săn sale đầu/cuối tháng cực hot',
          },
          {
            title: `Đêm Hội Hương Thơm - Flash Sale Nửa Đêm 20h - 22h`,
            badge: 'Giờ Vàng',
            description: 'Chớp nhoáng giá sốc chỉ trong 2 tiếng',
          },
          {
            title: `Xả Kho Cuối Tuần - Nước Hoa Pháp Đồng Giá`,
            badge: 'Xả Kho',
            description: 'Giảm giá chạm đáy số lượng có hạn',
          }
        ];
        return reply.send({
          success: true,
          data: fallback,
        });
      }
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message || 'Lỗi đề xuất tên sự kiện',
      });
    }
  }
}
