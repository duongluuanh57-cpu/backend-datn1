import type { FastifyRequest, FastifyReply } from 'fastify';
import { VoucherService } from '../services/VoucherService.ts';
import { requireAdmin } from '../utils/adminAuth.ts';

export class VoucherController {
  /** GET /api/vouchers — Lấy tất cả voucher (admin: all, user: active) */
  static async getAll(req: FastifyRequest, reply: FastifyReply) {
    try {
      const user = (req as any).user;

      if (user && (user.role === 'ADMIN' || user.role === 'SUBADMIN')) {
        let list = await VoucherService.getAll();
        const { applicableTo } = req.query as { applicableTo?: string };
        if (applicableTo) {
          list = list.filter((v: any) => v.applicableTo === applicableTo);
        }
        const enriched = list.map((v: any) => ({
          ...v,
          remaining: v.applicableTo === 'minigame' ? 'Không giới hạn' : Math.max(0, (v.maxUsage ?? 0) - (v.usedCount || 0)),
        }));
        return reply.send({ success: true, data: enriched });
      }

      const userTier = user?.memberTier || null;
      const userId = user?.userId || null;
      const { orderAmount, includeAll } = req.query as { orderAmount?: string; includeAll?: string };
      const totalAmount = orderAmount ? Number(orderAmount) : 0;
      const hasOrderAmount = orderAmount !== undefined && orderAmount !== '';

      let list: any[];
      if (includeAll === 'true') {
        // Trả về tất cả voucher (kể cả hết hạn, hết lượt) — dùng cho trang profile
        list = await VoucherService.getAll();
      } else {
        list = await VoucherService.getActive(userTier, userId);
      }

      // Add remaining field + eligible flag (chỉ khi có orderAmount)
      const enriched = list.map((v: any) => {
        const item: any = {
          ...v,
          remaining: v.applicableTo === 'minigame' ? 'Không giới hạn' : Math.max(0, (v.maxUsage ?? 0) - (v.usedCount || 0)),
        };
        if (hasOrderAmount) {
          item.eligible = totalAmount >= (v.minOrderAmount || 0);
        }
        return item;
      });
      return reply.send({ success: true, data: enriched });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /** GET /api/vouchers/:id */
  static async getById(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      const item = await VoucherService.getById(id);
      if (!item) return reply.status(404).send({ success: false, message: 'Không tìm thấy voucher' });
      return reply.send({ success: true, data: item });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /** POST /api/vouchers/validate — Kiểm tra mã giảm giá */
  static async validate(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { code, orderAmount } = req.body as { code: string; orderAmount: number };
      if (!code?.trim()) {
        return reply.status(400).send({ success: false, message: 'Vui lòng nhập mã giảm giá' });
      }
      if (!orderAmount || orderAmount <= 0) {
        return reply.status(400).send({ success: false, message: 'Số tiền đơn hàng không hợp lệ' });
      }

      const user = (req as any).user;
      const userTier = user?.memberTier || null;
      const userId = user?.userId || null;

      const result = await VoucherService.validate(code, orderAmount, userTier, userId);
      return reply.send({ success: result.valid, ...result });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /** POST /api/vouchers — Tạo voucher (admin) */
  static async create(req: FastifyRequest, reply: FastifyReply) {
    try {
      if (!requireAdmin(req, reply)) return;

      const body = req.body as any;
      if (!body.code?.trim()) return reply.status(400).send({ success: false, message: 'code là bắt buộc' });
      if (!body.type || !['percentage', 'fixed'].includes(body.type)) {
        return reply.status(400).send({ success: false, message: 'type phải là percentage hoặc fixed' });
      }
      if (!body.value || body.value <= 0) {
        return reply.status(400).send({ success: false, message: 'value phải lớn hơn 0' });
      }
      if (!body.startDate || !body.endDate) {
        return reply.status(400).send({ success: false, message: 'startDate và endDate là bắt buộc' });
      }

      const item = await VoucherService.create(body);
      return reply.status(201).send({ success: true, data: item });
    } catch (err: any) {
      if (err.code === 11000) {
        return reply.status(400).send({ success: false, message: 'Mã giảm giá này đã tồn tại' });
      }
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /** PATCH /api/vouchers/:id — Cập nhật voucher (admin) */
  static async update(req: FastifyRequest, reply: FastifyReply) {
    try {
      if (!requireAdmin(req, reply)) return;

      const { id } = req.params as { id: string };
      const body = req.body as any;
      const item = await VoucherService.update(id, body);
      if (!item) return reply.status(404).send({ success: false, message: 'Không tìm thấy voucher' });
      return reply.send({ success: true, data: item });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /** DELETE /api/vouchers/:id — Xoá voucher (admin) */
  static async remove(req: FastifyRequest, reply: FastifyReply) {
    try {
      if (!requireAdmin(req, reply)) return;

      const { id } = req.params as { id: string };
      const ok = await VoucherService.delete(id);
      if (!ok) return reply.status(404).send({ success: false, message: 'Không tìm thấy voucher' });
      return reply.send({ success: true, message: 'Đã xoá voucher' });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }
}