import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { FavoriteController } from '../controllers/favoriteController.ts';
import { authMiddleware } from '../middleware/authMiddleware.ts';

export async function favoriteRoutes(app: FastifyInstance) {
  // Rate limit riêng cho favorites — 1000 req/phút, cao hơn global để tránh giật khi toggle nhanh
  await app.register(rateLimit, {
    max: 1000,
    timeWindow: '1 minute',
    // rateLimit chạy ở pha onRequest — TRƯỚC authMiddleware — nên req.user chưa tồn tại.
    // Nhánh `user?._id` cũ chưa bao giờ chạy (req.user chỉ có userId, không có _id).
    // Key theo IP cho thật lòng; nếu muốn per-user phải dời rateLimit sau auth.
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: () => ({
      success: false,
      message: 'Vượt quá giới hạn yêu cầu, vui lòng thử lại sau',
    }),
  });

  app.addHook('preHandler', authMiddleware);

  // GET /api/favorites — Lấy danh sách yêu thích
  app.get('/', FavoriteController.getFavorites);

  // POST /api/favorites — Thêm sản phẩm vào yêu thích
  app.post('/', FavoriteController.addToFavorites);

  // DELETE /api/favorites/:productId — Xóa sản phẩm khỏi yêu thích
  app.delete('/:productId', FavoriteController.removeFromFavorites);

  // GET /api/favorites/ids — Lấy danh sách ID đã yêu thích (1 request)
  app.get('/ids', FavoriteController.getFavoriteIds);

  // GET /api/favorites/check/:productId — Kiểm tra trạng thái yêu thích
  app.get('/check/:productId', FavoriteController.checkFavorite);
}