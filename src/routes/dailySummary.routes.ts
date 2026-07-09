import type { FastifyInstance } from 'fastify';
import { redis } from '../config/redis.ts';
import { DailySummaryReport } from '../models/DailySummaryReport.ts';
import { adminAuthMiddleware } from '../middleware/adminAuthMiddleware.ts';

export async function dailySummaryRoutes(fastify: FastifyInstance) {
  fastify.get('/daily-summary', { preHandler: adminAuthMiddleware }, async (request, _reply) => {
    try {
      const { days: daysStr } = request.query as { days?: string };
      const days = Math.min(Math.max(parseInt(daysStr || '7', 10) || 7, 1), 90);
      const cacheKey = `daily-summary:${days}`;

      // Check Redis cache
      const cached = await redis.get(cacheKey);
      if (cached) {
        return { success: true, data: JSON.parse(cached), cached: true };
      }

      const since = new Date();
      since.setDate(since.getDate() - days + 1);
      since.setHours(0, 0, 0, 0);

      const reports = await DailySummaryReport.find({
        date: { $gte: since },
      })
        .sort({ date: -1 })
        .limit(days)
        .lean() as any[];

      const data = reports.map((r) => ({
        date: r.date,
        revenue: r.totalRevenue,
        orders: r.totalOrders,
        completedOrders: r.completedOrders,
        cancelledRevenue: r.cancelledRevenue,
      }));

      // Sort ascending for chart
      data.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // Cache in Redis with 30 min TTL
      await redis.set(cacheKey, JSON.stringify(data), 'EX', 1800);

      return { success: true, data, cached: false };
    } catch (error: any) {
      console.error('Daily summary error:', error);
      return { success: false, message: error.message };
    }
  });
}
