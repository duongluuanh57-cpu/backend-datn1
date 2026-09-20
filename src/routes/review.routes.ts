import type { FastifyInstance } from 'fastify';
import { ReviewController } from '../controllers/ReviewController.ts';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/authMiddleware.ts';

export async function reviewRoutes(app: FastifyInstance) {
  // Public (optionalAuth: user đăng nhập được xem thêm review của chính mình)
  app.get('/product/:productId', { preHandler: optionalAuthMiddleware }, ReviewController.getByProduct);
  app.get('/product/:productId/stats', ReviewController.getStats);

  // Auth
  app.post('/', { preHandler: authMiddleware }, ReviewController.create);
  app.get('/can-review/:productId', { preHandler: authMiddleware }, ReviewController.canReview);
  app.post('/upload-image', { preHandler: authMiddleware }, ReviewController.uploadReviewImage);

  // Admin
  app.get('/detail/:id', { preHandler: authMiddleware }, ReviewController.getById);
  app.patch('/:id/moderate', { preHandler: authMiddleware }, ReviewController.moderate);
  app.get('/all', { preHandler: authMiddleware }, ReviewController.getAll);
}
