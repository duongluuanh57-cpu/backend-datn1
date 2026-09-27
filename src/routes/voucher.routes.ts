import type { FastifyInstance } from 'fastify';
import { VoucherController } from '../controllers/VoucherController.ts';
import { authMiddleware, optionalAuthMiddleware, requireRole } from '../middleware/authMiddleware.ts';

/**
 * /api/vouchers
 *
 * Public / Optional Auth:
 *   POST  /api/vouchers/validate           — Kiểm tra mã giảm giá (nhận diện user nếu có token)
 *   GET   /api/vouchers                    — Admin: tất cả, User: active
 *
 * Admin:
 *   GET    /api/vouchers/:id               — Lấy chi tiết
 *   POST   /api/vouchers                   — Tạo voucher
 *   PATCH  /api/vouchers/:id               — Cập nhật voucher
 *   DELETE /api/vouchers/:id               — Xoá voucher
 */
export async function voucherRoutes(app: FastifyInstance) {
  // Public / Optional Auth
  // Giới hạn nghiêm ngặt để chặn dò/đoán mã giảm giá qua /validate.
  app.post('/validate', {
    preHandler: optionalAuthMiddleware,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, VoucherController.validate);
  app.get('/', { preHandler: optionalAuthMiddleware }, VoucherController.getAll);

  // Admin
  app.get('/:id', { preHandler: [authMiddleware, requireRole('ADMIN')] }, VoucherController.getById);
  app.post('/', { preHandler: [authMiddleware, requireRole('ADMIN')] }, VoucherController.create);
  app.patch('/:id', { preHandler: [authMiddleware, requireRole('ADMIN')] }, VoucherController.update);
  app.delete('/:id', { preHandler: [authMiddleware, requireRole('ADMIN')] }, VoucherController.remove);
}