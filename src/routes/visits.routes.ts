import type { FastifyInstance } from 'fastify';
import { redis } from '../config/redis.ts';
import { adminAuthMiddleware } from '../middleware/adminAuthMiddleware.ts';

export async function visitsRoutes(fastify: FastifyInstance) {
  fastify.get('/', { preHandler: adminAuthMiddleware }, async (_req, _reply) => {
    try {
      const dateStr = new Date().toISOString().split('T')[0];
      const visits = parseInt(await redis.get(`visits:${dateStr}:default`) || '0', 10);
      return { success: true, data: visits };
    } catch {
      return { success: true, data: 0 };
    }
  });

  fastify.post('/track', async (_request, _reply) => {
    const dateStr = new Date().toISOString().split('T')[0];
    const visitsKey = `visits:${dateStr}:default`;
    try {
      await redis.incr(visitsKey);
      await redis.expire(visitsKey, 172800);
      return { success: true };
    } catch (error) {
      console.error('Error tracking visit:', error);
      return { success: false };
    }
  });
}
