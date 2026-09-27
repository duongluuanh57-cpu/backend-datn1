import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { VoucherService } from '../services/VoucherService.ts';
import { requireAdmin } from '../utils/adminAuth.ts';

/**
 * Kiểm dữ liệu voucher chỉ theo các trường có mặt trong body (dùng chung cho
 * create và update). Trả về chuỗi lỗi hoặc null nếu hợp lệ.
 */
function validateVoucherFields(body: any): string | null {
  if (body.type !== undefined && !['percentage', 'fixed'].includes(body.type)) {
    return 'type phải là percentage hoặc fixed';
  }
  if (body.maxUsage !== undefined && (!Number.isInteger(Number(body.maxUsage)) || Number(body.maxUsage) <= 0)) {
    return 'maxUsage phải là số nguyên lớn hơn 0';
  }
  const isFreeship = body.voucherCategory === 'freeship';
  if (body.value !== undefined && !isFreeship) {
    const v = Number(body.value);
    if (!(v > 0)) return 'value phải lớn hơn 0';
    if (body.type === 'percentage' && v > 100) return 'Giá trị phần trăm không được vượt quá 100%';
  }
  if (body.startDate && body.endDate && new Date(body.startDate) >= new Date(body.endDate)) {
    return 'Ngày kết thúc phải lớn hơn ngày bắt đầu';
  }
  return null;
}

export class VoucherController {
  /** GET /api/vouchers — admin xem tất cả; người dùng chỉ thấy voucher dùng chung đang active. */
  static async getAll(req: FastifyRequest, reply: FastifyReply) {
    try {
      const user = (req as any).user;
      const { status, type, search, sortBy, forAdmin, orderAmount, includeAll } = req.query as {
        status?: string;
        type?: string;
        search?: string;
        sortBy?: string;
        forAdmin?: string;
        orderAmount?: string;
        includeAll?: string;
      };

      if (user && (user.role === 'ADMIN') && (forAdmin === 'true' || search !== undefined || sortBy !== undefined)) {
        let list = await VoucherService.getAll();
        if (type) {
          list = list.filter((v: any) => v.type === type);
        }
        if (status) {
          if (status === 'active') list = list.filter((v: any) => v.status === 'active');
          else if (status === 'inactive') list = list.filter((v: any) => v.status === 'inactive');
        }
        if (search) {
          const s = search.toLowerCase().trim();
          list = list.filter((v: any) => v.code && v.code.toLowerCase().includes(s));
        }
        if (sortBy === 'outOfUsage') {
          list = list.filter((v: any) => (v.usedCount || 0) >= v.maxUsage);
        } else if (sortBy === 'newest') {
          list.sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
        } else if (sortBy === 'oldest') {
          list.sort((a: any, b: any) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
        }
        const enriched = list.map((v: any) => ({
          ...v,
          remaining: Math.max(0, v.maxUsage - (v.usedCount || 0)),
        }));
        return reply.send({ success: true, data: enriched });
      }

      const userTier = user?.memberTier || 'MEMBER';
      const userId = user?.userId || null;
      const totalAmount = orderAmount ? Number(orderAmount) : 0;
      const hasOrderAmount = orderAmount !== undefined && orderAmount !== '';

      const list = await VoucherService.getActive(userTier, userId);

      // Add remaining field + eligible flag (chỉ khi có orderAmount)
      const enriched = list.map((v: any) => {
        const item: any = {
          ...v,
          remaining: Math.max(0, v.maxUsage - (v.usedCount || 0)),
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
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return reply.status(400).send({ success: false, message: 'ID voucher không hợp lệ' });
      }
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
      if (!body.type) return reply.status(400).send({ success: false, message: 'type là bắt buộc' });
      if (body.voucherCategory !== 'freeship' && (body.value === undefined || body.value === null || body.value === '')) {
        return reply.status(400).send({ success: false, message: 'value là bắt buộc' });
      }
      if (!Number.isInteger(Number(body.maxUsage)) || Number(body.maxUsage) <= 0) {
        return reply.status(400).send({ success: false, message: 'maxUsage phải là số nguyên lớn hơn 0' });
      }
      if (!body.startDate || !body.endDate) {
        return reply.status(400).send({ success: false, message: 'startDate và endDate là bắt buộc' });
      }

      const fieldError = validateVoucherFields(body);
      if (fieldError) return reply.status(400).send({ success: false, message: fieldError });

      body.maxUsage = Number(body.maxUsage);

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
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return reply.status(400).send({ success: false, message: 'ID voucher không hợp lệ' });
      }
      const body = req.body as any;

      const fieldError = validateVoucherFields(body);
      if (fieldError) return reply.status(400).send({ success: false, message: fieldError });

      const item = await VoucherService.update(id, body);
      if (!item) return reply.status(404).send({ success: false, message: 'Không tìm thấy voucher' });
      return reply.send({ success: true, data: item });
    } catch (err: any) {
      if (err.code === 11000) {
        return reply.status(400).send({ success: false, message: 'Mã giảm giá này đã tồn tại' });
      }
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /** DELETE /api/vouchers/:id — Xoá voucher (admin) */
  static async remove(req: FastifyRequest, reply: FastifyReply) {
    try {
      if (!requireAdmin(req, reply)) return;

      const { id } = req.params as { id: string };
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return reply.status(400).send({ success: false, message: 'ID voucher không hợp lệ' });
      }
      const ok = await VoucherService.delete(id);
      if (!ok) return reply.status(404).send({ success: false, message: 'Không tìm thấy voucher' });
      return reply.send({ success: true, message: 'Đã xoá voucher' });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }
}