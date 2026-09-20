import type { FastifyInstance } from 'fastify';
import { getAllOrdersForAdmin, getOrderByIdForAdmin, updateOrderStatus, cancelOrderByAdmin } from '../controllers/order/orderAdminController.ts';
import { getMyOrders, getOrderById, cancelOrder } from '../controllers/order/orderController.ts';
import { authMiddleware, requireRole } from '../middleware/authMiddleware.ts';

async function adminOrderRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);
  app.addHook('preHandler', requireRole('ADMIN'));

  app.get('/orders', getAllOrdersForAdmin);
  app.get('/:id', getOrderByIdForAdmin);
  app.patch('/:id/status', updateOrderStatus);
  app.patch('/:id/cancel', cancelOrderByAdmin);
}

export async function orderRoutes(app: FastifyInstance) {
  // User routes
  app.get('/my-orders', { preHandler: [authMiddleware] }, getMyOrders);
  app.get('/:id', { preHandler: [authMiddleware] }, getOrderById);
  app.patch('/:id/cancel', { preHandler: [authMiddleware] }, cancelOrder);

  // Admin routes — registered under /admin prefix (no conflict with /:id)
  await app.register(adminOrderRoutes, { prefix: '/admin' });
}
