import type { FastifyRequest, FastifyReply } from 'fastify';
import { VoucherService } from '../services/VoucherService.ts';

function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  const user = (req as any).user;
  if (!user || (user.role !== 'ADMIN' && user.role !== 'SUBADMIN')) {
    reply.status(403).send({
      success: false,
      message: 'Bạn không có quyền thực hiện hành động này',
    });
    return false;
  }
  return true;
}

export class VoucherController {
  /** GET /api/vouchers — Lấy tất cả voucher (admin: all, user: active) */
  static async getAll(req: FastifyRequest, reply: FastifyReply) {
    try {
      const user = (req as any).user;

      if (user && (user.role === 'ADMIN' || user.role === 'SUBADMIN')) {
        const list = await VoucherService.getAll();
        return reply.send({ success: true, data: list });
      }

      const list = await VoucherService.getActive();
      return reply.send({ success: true, data: list });
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

      const result = await VoucherService.validate(code, orderAmount);
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