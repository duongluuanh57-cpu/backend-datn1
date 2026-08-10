import type { FastifyInstance } from 'fastify';
import { TagController } from '../controllers/TagController.ts';
import { authMiddleware, requireRole } from '../middleware/authMiddleware.ts';

export async function tagRoutes(app: FastifyInstance) {
  // Public routes
  app.get('/', TagController.getAllTags);
  app.get('/:id', TagController.getTagById);
  app.get('/:id/detail', TagController.getTagDetail);
  app.get('/:id/products', TagController.getTagProducts);

  // Private routes (Admin only)
  app.post('/', { preHandler: [authMiddleware, requireRole('ADMIN', 'SUBADMIN')] }, TagController.createTag);
  app.patch('/:id', { preHandler: [authMiddleware, requireRole('ADMIN', 'SUBADMIN')] }, TagController.updateTag);
  app.delete('/:id', { preHandler: [authMiddleware, requireRole('ADMIN', 'SUBADMIN')] }, TagController.deleteTag);
  app.post('/bulk-delete', { preHandler: [authMiddleware, requireRole('ADMIN', 'SUBADMIN')] }, TagController.bulkDeleteTags);
}
