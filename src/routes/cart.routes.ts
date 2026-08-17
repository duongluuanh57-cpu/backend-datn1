import type { FastifyInstance } from 'fastify';
import { CartController } from '../controllers/CartController.ts';
import { CheckoutController } from '../controllers/CheckoutController.ts';
import { authMiddleware } from '../middleware/authMiddleware.ts';

export async function cartRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // GET /api/cart — Lấy giỏ hàng
  app.get('/', CartController.getCart);

  // POST /api/cart/add — Thêm sản phẩm vào giỏ
  app.post('/add', CartController.addToCart);

  // PATCH /api/cart/item — Cập nhật số lượng
  app.patch('/item', CartController.updateCartItem);

  // PATCH /api/cart/item/variant — Đổi biến thể sản phẩm
  app.patch('/item/variant', CartController.updateCartItemVariant);

  // DELETE /api/cart/item/:productId — Xóa 1 sản phẩm
  app.delete('/item/:productId', CartController.removeCartItem);

  // DELETE /api/cart — Xóa toàn bộ giỏ
  app.delete('/', CartController.clearCart);

  // GET /api/cart/vouchers — Danh sách voucher khả dụng
  app.get('/vouchers', CartController.listAvailableVouchers);

  // POST /api/cart/apply-voucher — Áp dụng mã giảm giá
  app.post('/apply-voucher', CartController.applyVoucher);

  // POST /api/cart/remove-voucher — Hủy mã giảm giá
  app.post('/remove-voucher', CartController.removeVoucher);

  // POST /api/cart/checkout — Tạo đơn hàng từ giỏ hàng
  app.post('/checkout', CheckoutController.checkout);
}
