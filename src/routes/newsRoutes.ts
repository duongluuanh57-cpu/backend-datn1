import type { FastifyInstance } from 'fastify';
import { NewsController } from '../controllers/news/newsController.ts';
import { authMiddleware, requireRole } from '../middleware/authMiddleware.ts';

export async function newsRoutes(fastify: FastifyInstance) {
  // Public routes
  fastify.get('/news', NewsController.getPublicArticles);
  fastify.get('/news/:slug', NewsController.getArticleBySlug);

  // Admin routes
  fastify.get('/admin/news', { preHandler: [authMiddleware, requireRole('ADMIN')] }, NewsController.getAdminArticles);
  fastify.post('/admin/news', { preHandler: [authMiddleware, requireRole('ADMIN')] }, NewsController.createArticle);
  fastify.put('/admin/news/:id', { preHandler: [authMiddleware, requireRole('ADMIN')] }, NewsController.updateArticle);
  fastify.patch('/admin/news/:id/toggle-visibility', { preHandler: [authMiddleware, requireRole('ADMIN')] }, NewsController.toggleVisibility);
  fastify.delete('/admin/news/:id', { preHandler: [authMiddleware, requireRole('ADMIN')] }, NewsController.deleteArticle);
}
