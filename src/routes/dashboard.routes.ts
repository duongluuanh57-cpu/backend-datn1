import type { FastifyInstance } from 'fastify';
import { adminAuthMiddleware } from '../middleware/adminAuthMiddleware.ts';
import { DashboardStatsController } from '../controllers/admin/dashboardStatsController.ts';

export async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.get('/dashboard-stats', { preHandler: adminAuthMiddleware }, DashboardStatsController.getSummaryStats);
  fastify.get('/sales-trend', { preHandler: adminAuthMiddleware }, DashboardStatsController.getSalesTrend);
  fastify.get('/top-brands', { preHandler: adminAuthMiddleware }, DashboardStatsController.getTopBrands);
  fastify.get('/hourly-sales', { preHandler: adminAuthMiddleware }, DashboardStatsController.getHourlySales);
}
