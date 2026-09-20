import type { FastifyInstance } from 'fastify';
import {
  getMyTickets,
  getTicketDetail,
  createTicket,
  createGuestTicket,
  replyTicket,
  updateTicketStatus,
  getAllTicketsAdmin,
  adminUpdateTicket,
  uploadTicketImage,
} from '../controllers/support/supportTicketController.ts';
import { authMiddleware, requireRole } from '../middleware/authMiddleware.ts';

async function adminSupportTicketRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);
  app.addHook('preHandler', requireRole('ADMIN'));

  app.get('/', getAllTicketsAdmin);
  app.patch('/:id', adminUpdateTicket);
}

export async function supportTicketRoutes(app: FastifyInstance) {
  // Admin routes — prefix /admin (registered first to avoid collision with /:id)
  await app.register(adminSupportTicketRoutes, { prefix: '/admin' });

  // User authenticated endpoints
  app.get('/my-tickets', { preHandler: [authMiddleware] }, getMyTickets);
  app.post('/upload-image', { preHandler: [authMiddleware] }, uploadTicketImage);
  app.get('/:id', { preHandler: [authMiddleware] }, getTicketDetail);
  app.post('/', { preHandler: [authMiddleware] }, createTicket);
  app.post('/guest', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, createGuestTicket);
  app.post('/:id/replies', { preHandler: [authMiddleware] }, replyTicket);
  app.patch('/:id/status', { preHandler: [authMiddleware] }, updateTicketStatus);
}
