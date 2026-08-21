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
   * AI đề xuất tên sự kiện Flash Sale theo thời gian, ngày lễ hoặc từ khóa (kèm khung giờ đề xuất)
   */
  static async suggestName(req: FastifyRequest, reply: FastifyReply) {
    try {
      const query = req.query as { date?: string; keyword?: string };
      const dateStr = query.date || new Date().toISOString();
      const keyword = (query.keyword || '').trim();

      const { redis } = await import('../config/redis.ts');
      const cacheKey = `flash_sale:ai_suggest:${dateStr.split('T')[0]}:${keyword.toLowerCase()}`;
      
      // 1. Kiểm tra cache Redis để trả kết quả tức thì (0ms)
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          return reply.send({ success: true, data: JSON.parse(cached), cached: true });
        }
      } catch {}

      const targetDate = new Date(dateStr);
      const day = targetDate.getDate();
      const month = targetDate.getMonth() + 1;
      const year = targetDate.getFullYear();
      const datePrefix = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      const { getGeminiClient, PRIMARY_MODEL } = await import('../services/ai/aiClient.ts');

      const prompt = `Bạn là chuyên gia Marketing E-commerce cho sàn thương mại điện tử nước hoa L'Essence (phong cách Shopee / TikTok Shop).
Nhiệm vụ: Hãy đề xuất 5 tên sự kiện Flash Sale kèm khung giờ diễn ra lý tưởng.
Thông tin:
- Ngày tổ chức: ${day}/${month}/${year} (Kiểm tra ngày đôi ${day}.${month}, đầu tháng lương về, cuối tháng xả kho, lễ 8/3, 20/10, 14/2, Black Friday...).
${keyword ? `- Từ khóa người dùng: "${keyword}"` : ''}

Định dạng JSON thuần:
{
  "suggestions": [
    {
      "title": "Tên sự kiện giật tít bắt mắt",
      "badge": "Tag ngắn (VD: Siêu Sale / Lương Về / Khung Giờ Vàng)",
      "description": "Lý do ngắn gọn",
      "startHour": 20,
      "endHour": 22
    }
  ]
}`;

      let suggestions: any[] = [];

      try {
        const client = getGeminiClient();
        const model = client.getGenerativeModel({
          model: PRIMARY_MODEL,
          generationConfig: { responseMimeType: 'application/json' }
        });
        const res = await model.generateContent(prompt);
        const parsed = JSON.parse(res.response.text());
        suggestions = (parsed.suggestions || []).map((s: any) => {
          const sH = typeof s.startHour === 'number' ? s.startHour : 20;
          const eH = typeof s.endHour === 'number' ? s.endHour : (sH + 2);
          return {
            title: s.title,
            badge: s.badge || 'Flash Sale',
            description: s.description || '',
            suggestedStartDate: `${datePrefix}T${String(sH).padStart(2, '0')}:00`,
            suggestedEndDate: `${datePrefix}T${String(Math.min(23, eH)).padStart(2, '0')}:59`,
          };
        });
      } catch (aiErr) {
        // Fallback tức thì nếu AI lỗi
        suggestions = [
          {
            title: `Flash Sale Giờ Vàng ${day}.${month} - Săn Deal Nước Hoa Hàng Hiệu`,
            badge: `Siêu Sale ${day}.${month}`,
            description: `Khung giờ vàng 12h - 14h ngày ${day}/${month}`,
            suggestedStartDate: `${datePrefix}T12:00`,
            suggestedEndDate: `${datePrefix}T14:00`,
          },
          {
            title: `Đêm Hội Hương Thơm - Flash Sale Nửa Đêm 20h - 22h`,
            badge: 'Giờ Vàng 20h-22h',
            description: 'Chớp nhoáng giá sốc trong 2 tiếng tối nay',
            suggestedStartDate: `${datePrefix}T20:00`,
            suggestedEndDate: `${datePrefix}T22:00`,
          },
          {
            title: `Sale Lương Về - Nước Hoa Chính Hãng Giảm Đến 50%`,
            badge: 'Lương Về',
            description: 'Đại tiệc săn sale đầu/cuối tháng cực hot',
            suggestedStartDate: `${datePrefix}T09:00`,
            suggestedEndDate: `${datePrefix}T23:59`,
          },
          {
            title: `Xả Kho Cuối Tuần - Đồng Giá Nước Hoa Pháp`,
            badge: 'Xả Kho',
            description: 'Giảm giá chạm đáy số lượng có hạn',
            suggestedStartDate: `${datePrefix}T08:00`,
            suggestedEndDate: `${datePrefix}T22:00`,
          }
        ];
      }

      // Lưu cache 2 giờ
      try {
        await redis.set(cacheKey, JSON.stringify(suggestions), 'EX', 7200);
      } catch {}

      return reply.send({
        success: true,
        data: suggestions,
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message || 'Lỗi đề xuất tên sự kiện',
      });
    }
  }
}
