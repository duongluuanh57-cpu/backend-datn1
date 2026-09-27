import type { FastifyInstance } from 'fastify';
import { TagController } from '../controllers/TagController.ts';
import { authMiddleware, requireRole } from '../middleware/authMiddleware.ts';

export async function tagRoutes(app: FastifyInstance) {
  // Public routes
  app.get('/', TagController.getAllTags);
  app.get('/:id', TagController.getTagById);
  app.get('/:id/detail', TagController.getTagDetail);
  app.get('/:id/products', TagController.getTagProducts);

  // Tag là dữ liệu cố định của web: chỉ cho phép bật/ẩn.
  app.patch('/:id', { preHandler: [authMiddleware, requireRole('ADMIN')] }, TagController.updateTagStatus);
}
