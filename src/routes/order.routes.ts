import type { FastifyInstance } from 'fastify';
import { getAllOrdersForAdmin, getOrderByIdForAdmin, updateOrderStatus, updatePaymentStatus, approveCancelRequest, rejectCancelRequest, deleteOrder } from '../controllers/order/orderAdminController.ts';
import { getMyOrders, getOrderById, getOrderByTxnRef, cancelOrder } from '../controllers/order/orderUserController.ts';
import { authMiddleware, requireRole } from '../middleware/authMiddleware.ts';

async function adminOrderRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);
  app.addHook('preHandler', requireRole('ADMIN', 'SUBADMIN'));

  app.get('/orders', getAllOrdersForAdmin);
  app.get('/:id', getOrderByIdForAdmin);
  app.patch('/:id/status', updateOrderStatus);
  app.patch('/:id/payment-status', updatePaymentStatus);
  app.patch('/:id/approve-cancel', approveCancelRequest);
  app.patch('/:id/reject-cancel', rejectCancelRequest);
  app.delete('/:id', deleteOrder);
}

export async function orderRoutes(app: FastifyInstance) {
  // Test endpoint
  app.get('/test-simple', async (req, reply) => {
    return reply.status(200).send({
      success: true,
      message: 'Orders test endpoint works!',
      timestamp: new Date().toISOString()
    });
  });

  // User routes
  app.get('/my-orders', { preHandler: [authMiddleware] }, getMyOrders);
  app.get('/by-txn-ref/:txnRef', getOrderByTxnRef);
  app.get('/:id', { preHandler: [authMiddleware] }, getOrderById);
  app.patch('/:id/cancel', { preHandler: [authMiddleware] }, cancelOrder);

  // Admin routes — registered under /admin prefix (no conflict with /:id)
  await app.register(adminOrderRoutes, { prefix: '/admin' });
}
