import type { FastifyInstance } from 'fastify';
import { redis } from '../config/redis.ts';
import { DailySummaryReport } from '../models/DailySummaryReport.ts';
import { adminAuthMiddleware } from '../middleware/adminAuthMiddleware.ts';
import { DashboardStatsController } from '../controllers/admin/dashboardStatsController.ts';

export async function dailySummaryRoutes(fastify: FastifyInstance) {
  fastify.get('/dashboard-stats', DashboardStatsController.getSummaryStats);
  fastify.get('/daily-summary', { preHandler: adminAuthMiddleware }, async (request, _reply) => {
    try {
      const { days: daysStr, startDate: startStr, endDate: endStr } = request.query as { days?: string; startDate?: string; endDate?: string };
      
      let reports: any[];
      let cacheKey: string;
      
      if (startStr && endStr) {
        let start = new Date(startStr);
        let end = new Date(endStr);
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
          return { success: false, message: 'Ngày bắt đầu hoặc ngày kết thúc không hợp lệ' };
        }
        
        if (start > end) {
          const temp = start;
          start = end;
          end = temp;
        }
        
        const diffTime = Math.abs(end.getTime() - start.getTime());
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
        if (diffDays > 90) {
          return { success: false, message: 'Khoảng thời gian truy vấn tối đa là 90 ngày' };
        }
        
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        
        // Cache key for date range queries
        cacheKey = `daily-summary:range:${start.toISOString().split('T')[0]}:${end.toISOString().split('T')[0]}`;
        
        const cached = await redis.get(cacheKey);
        if (cached) {
          return { success: true, data: JSON.parse(cached), cached: true };
        }
        
        reports = await DailySummaryReport.find({
          date: { $gte: start, $lte: end },
        })
          .sort({ date: -1 })
          .limit(diffDays)
          .lean() as any[];
      } else {
        const days = Math.min(Math.max(parseInt(daysStr || '7', 10) || 7, 1), 90);
        cacheKey = `daily-summary:${days}`;
        
        const cached = await redis.get(cacheKey);
        if (cached) {
          return { success: true, data: JSON.parse(cached), cached: true };
        }
        
        const since = new Date();
        since.setDate(since.getDate() - days + 1);
        since.setHours(0, 0, 0, 0);
        
        reports = await DailySummaryReport.find({
          date: { $gte: since },
        })
          .sort({ date: -1 })
          .limit(days)
          .lean() as any[];
      }

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
