import type { FastifyInstance } from 'fastify';
import { NewsController } from '../controllers/news/newsController.ts';
import { NewsAutoPilotController } from '../controllers/news/newsAutoPilotController.ts';
import { authMiddleware, requireRole } from '../middleware/authMiddleware.ts';

export async function newsRoutes(fastify: FastifyInstance) {
  // Public routes
  fastify.get('/news', NewsController.getPublicArticles);
  fastify.get('/news/:slug', NewsController.getArticleBySlug);

  // Admin routes — Auto-Pilot AI Publishing
  fastify.get('/admin/news/auto-pilot', { preHandler: [authMiddleware, requireRole('ADMIN')] }, NewsAutoPilotController.getConfig);
  fastify.put('/admin/news/auto-pilot', { preHandler: [authMiddleware, requireRole('ADMIN')] }, NewsAutoPilotController.updateConfig);
  fastify.post('/admin/news/auto-pilot/toggle', { preHandler: [authMiddleware, requireRole('ADMIN')] }, NewsAutoPilotController.toggleAutoPilot);
  fastify.post('/admin/news/auto-pilot/trigger-now', { preHandler: [authMiddleware, requireRole('ADMIN')] }, NewsAutoPilotController.triggerNow);

  // Admin routes — Article Management
  fastify.get('/admin/news', { preHandler: [authMiddleware, requireRole('ADMIN')] }, NewsController.getAdminArticles);
  fastify.get('/admin/news/:id', { preHandler: [authMiddleware, requireRole('ADMIN')] }, NewsController.getAdminArticleById);
  fastify.post('/admin/news', { preHandler: [authMiddleware, requireRole('ADMIN')] }, NewsController.createArticle);
  fastify.put('/admin/news/:id', { preHandler: [authMiddleware, requireRole('ADMIN')] }, NewsController.updateArticle);
  fastify.patch('/admin/news/:id/toggle-visibility', { preHandler: [authMiddleware, requireRole('ADMIN')] }, NewsController.toggleVisibility);
  fastify.delete('/admin/news/:id', { preHandler: [authMiddleware, requireRole('ADMIN')] }, NewsController.deleteArticle);
}
