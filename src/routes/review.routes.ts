import type { FastifyInstance } from 'fastify';
import { ReviewController } from '../controllers/ReviewController.ts';
import { authMiddleware } from '../middleware/authMiddleware.ts';

export async function reviewRoutes(app: FastifyInstance) {
  // Public
  app.get('/product/:productId', ReviewController.getByProduct);
  app.get('/product/:productId/stats', ReviewController.getStats);

  // Auth
  app.post('/', { preHandler: authMiddleware }, ReviewController.create);
  app.patch('/:id', { preHandler: authMiddleware }, ReviewController.update);
  app.delete('/:id', { preHandler: authMiddleware }, ReviewController.delete);
  app.get('/me', { preHandler: authMiddleware }, ReviewController.getMyReviews);
  app.get('/can-review/:productId', { preHandler: authMiddleware }, ReviewController.canReview);
  app.post('/upload-image', { preHandler: authMiddleware }, ReviewController.uploadReviewImage);

  // Admin
  app.get('/detail/:id', { preHandler: authMiddleware }, ReviewController.getById);
  app.patch('/:id/moderate', { preHandler: authMiddleware }, ReviewController.moderate);
  app.get('/all', { preHandler: authMiddleware }, ReviewController.getAll);
}
