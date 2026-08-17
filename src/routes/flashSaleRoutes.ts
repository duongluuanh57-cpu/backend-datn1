import type { FastifyInstance } from 'fastify';
import { FlashSaleController } from '../controllers/FlashSaleController.ts';
import { authMiddleware, requireRole } from '../middleware/authMiddleware.ts';

export async function flashSaleRoutes(app: FastifyInstance) {
  // Public Client API
  app.get('/active', FlashSaleController.getActiveFlashSale);

  const adminOnly = [authMiddleware, requireRole('ADMIN')];

  // Admin APIs
  app.get('/admin', { preHandler: adminOnly }, FlashSaleController.getAdminFlashSales);
  app.get('/admin/:id', { preHandler: adminOnly }, FlashSaleController.getById);
  app.post('/admin', { preHandler: adminOnly }, FlashSaleController.create);
  app.patch('/admin/:id', { preHandler: adminOnly }, FlashSaleController.update);
  app.delete('/admin/:id', { preHandler: adminOnly }, FlashSaleController.delete);
  app.post('/assign-product', { preHandler: adminOnly }, FlashSaleController.assignProduct);
}
