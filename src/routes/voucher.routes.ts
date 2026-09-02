import type { FastifyInstance } from 'fastify';
import { VoucherController } from '../controllers/VoucherController.ts';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/authMiddleware.ts';

/**
 * /api/vouchers
 *
 * Public / Optional Auth:
 *   POST  /api/vouchers/validate           — Kiểm tra mã giảm giá (nhận diện user nếu có token)
 *
 * Auth:
 *   GET   /api/vouchers                    — Admin: tất cả, User: active
 *   GET   /api/vouchers/:id                — Lấy chi tiết
 *
 * Admin:
 *   POST   /api/vouchers                   — Tạo voucher
 *   PATCH  /api/vouchers/:id               — Cập nhật voucher
 *   DELETE /api/vouchers/:id               — Xoá voucher
 */
export async function voucherRoutes(app: FastifyInstance) {
  // Public / Optional Auth
  app.post('/validate', { preHandler: optionalAuthMiddleware }, VoucherController.validate);
  app.get('/', { preHandler: optionalAuthMiddleware }, VoucherController.getAll);

  // Auth
  app.get('/:id', { preHandler: authMiddleware }, VoucherController.getById);

  // Admin
  app.post('/', { preHandler: authMiddleware }, VoucherController.create);
  app.patch('/:id', { preHandler: authMiddleware }, VoucherController.update);
  app.delete('/:id', { preHandler: authMiddleware }, VoucherController.remove);
}