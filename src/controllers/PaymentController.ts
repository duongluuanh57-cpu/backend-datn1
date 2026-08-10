import type { FastifyRequest, FastifyReply } from 'fastify';
import { PaymentService, PaymentMethodService } from '../services/PaymentService.ts';
import { requireAdmin } from '../utils/adminAuth.ts';

// ─── Payment Methods ───

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
      const body = req.body as { name: string; code: string; icon?: string; sortOrder?: number };
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
      const body = req.body as { name?: string; icon?: string; isActive?: boolean; sortOrder?: number };
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
      const ok = await PaymentMethodService.delete(id);
      if (!ok) return reply.status(404).send({ success: false, message: 'Không tìm thấy' });
      return reply.send({ success: true, message: 'Đã xóa' });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }
}

// ─── Payment Transactions ───

export class PaymentController {
  static async getAll(req: FastifyRequest, reply: FastifyReply) {
    if (!requireAdmin(req, reply)) return;
    const list = await PaymentService.getAll();
    return reply.send({ success: true, data: list });
  }

  static async getById(req: FastifyRequest, reply: FastifyReply) {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const item = await PaymentService.getById(id);
    if (!item) return reply.status(404).send({ success: false, message: 'Không tìm thấy' });
    return reply.send({ success: true, data: item });
  }

  static async getByOrder(req: FastifyRequest, reply: FastifyReply) {
    if (!requireAdmin(req, reply)) return;
    const { orderId } = req.params as { orderId: string };
    const items = await PaymentService.getByOrder(orderId);
    return reply.send({ success: true, data: items });
  }

  static async create(req: FastifyRequest, reply: FastifyReply) {
    if (!requireAdmin(req, reply)) return;
    const body = req.body as { orderId: string; method: string };
    const item = await PaymentService.create(body);
    return reply.status(201).send({ success: true, data: item });
  }

  static async markPaid(req: FastifyRequest, reply: FastifyReply) {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const { transactionCode } = req.body as { transactionCode?: string };
    const item = await PaymentService.markPaid(id, transactionCode);
    if (!item) return reply.status(404).send({ success: false, message: 'Không tìm thấy' });
    return reply.send({ success: true, data: item });
  }

  static async markFailed(req: FastifyRequest, reply: FastifyReply) {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const item = await PaymentService.markFailed(id);
    if (!item) return reply.status(404).send({ success: false });
    return reply.send({ success: true, data: item });
  }

  static async markRefunded(req: FastifyRequest, reply: FastifyReply) {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const item = await PaymentService.markRefunded(id);
    if (!item) return reply.status(404).send({ success: false });
    return reply.send({ success: true, data: item });
  }

  static async remove(req: FastifyRequest, reply: FastifyReply) {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const ok = await PaymentService.delete(id);
    if (!ok) return reply.status(404).send({ success: false });
    return reply.send({ success: true, message: 'Đã xóa' });
  }
}