import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { PaymentMethodService } from '../services/PaymentService.ts';
import type { PaymentMethodCode } from '../models/PaymentMethod.ts';
import { requireAdmin } from '../utils/adminAuth.ts';

/** ID không hợp lệ → 400 thay vì để Mongoose CastError thành 500 (quy ước toàn dự án). */
const isInvalidId = (id?: string) => !id || !mongoose.Types.ObjectId.isValid(id);

/**
 * Danh mục phương thức thanh toán.
 *
 * Bảng `payments` (giao dịch) đã bị xoá — mã giao dịch nằm ngay trên `orders`
 * (payment_txn_ref, payment_transaction_code, bank_code, paid_at), nên không còn
 * API admin cho giao dịch. Muốn xem đối soát thì đọc từ đơn hàng.
 */
export class PaymentMethodController {
  /** GET /api/payment-methods — public, chỉ lấy active */
  static async getActive(req: FastifyRequest, reply: FastifyReply) {
    try {
      const methods = await PaymentMethodService.getAll(true);
      return reply.send({ success: true, data: methods });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /** GET /api/payment-methods/all — admin */
  static async getAll(req: FastifyRequest, reply: FastifyReply) {
    try {
      if (!requireAdmin(req, reply)) return;
      const methods = await PaymentMethodService.getAll(false);
      return reply.send({ success: true, data: methods });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /** POST /api/payment-methods — admin tạo */
  static async create(req: FastifyRequest, reply: FastifyReply) {
    try {
      if (!requireAdmin(req, reply)) return;
      const body = req.body as { name: string; code: PaymentMethodCode; description?: string; icon?: string };
      const method = await PaymentMethodService.create(body);
      return reply.status(201).send({ success: true, data: method });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /** PATCH /api/payment-methods/:id — admin sửa */
  static async update(req: FastifyRequest, reply: FastifyReply) {
    try {
      if (!requireAdmin(req, reply)) return;
      const { id } = req.params as { id: string };
      if (isInvalidId(id)) return reply.status(400).send({ success: false, message: 'ID không hợp lệ' });
      const body = req.body as { name?: string; description?: string; icon?: string; status?: 'active' | 'inactive' };
      const method = await PaymentMethodService.update(id, body);
      if (!method) return reply.status(404).send({ success: false, message: 'Không tìm thấy' });
      return reply.send({ success: true, data: method });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /** DELETE /api/payment-methods/:id — admin xóa */
  static async remove(req: FastifyRequest, reply: FastifyReply) {
    try {
      if (!requireAdmin(req, reply)) return;
      const { id } = req.params as { id: string };
      if (isInvalidId(id)) return reply.status(400).send({ success: false, message: 'ID không hợp lệ' });
      const ok = await PaymentMethodService.delete(id);
      if (!ok) return reply.status(404).send({ success: false, message: 'Không tìm thấy' });
      return reply.send({ success: true, message: 'Đã xóa' });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }  }
}
