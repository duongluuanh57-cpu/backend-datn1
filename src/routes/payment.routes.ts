import type { FastifyInstance } from 'fastify';
import { PaymentMethodController } from '../controllers/PaymentController.ts';
import { authMiddleware } from '../middleware/authMiddleware.ts';

export async function paymentRoutes(app: FastifyInstance) {
  // ─── Payment Methods (public) ───
  app.get('/payment-methods', PaymentMethodController.getActive);

  // ─── Payment Methods (admin) ───
  app.get('/payment-methods/all', { preHandler: authMiddleware }, PaymentMethodController.getAll);
  app.post('/payment-methods', { preHandler: authMiddleware }, PaymentMethodController.create);
  app.patch('/payment-methods/:id', { preHandler: authMiddleware }, PaymentMethodController.update);
  app.delete('/payment-methods/:id', { preHandler: authMiddleware }, PaymentMethodController.remove);

  // ─── Giao dịch thanh toán ───
  // Bảng `payments` đã bị xoá: mã giao dịch (payment_txn_ref, bank_code, paid_at)
  // nằm ngay trên đơn hàng → xem qua /api/orders/admin/:id.
}