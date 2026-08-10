import type { FastifyRequest, FastifyReply } from 'fastify';
import { Product } from '../../models/Product.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { Order } from '../../models/Order.ts';
import { User } from '../../models/User.ts';
import { redis } from '../../config/redis.ts';

export class DashboardStatsController {
  private static CACHE_KEY = 'admin:dashboard:summary_kpis';
  private static CACHE_TTL = 30; // 30 seconds

  static async getSummaryStats(req: FastifyRequest, reply: FastifyReply) {
    try {
      // 1. Try reading from Redis cache
      const cached = await redis.get(DashboardStatsController.CACHE_KEY);
      if (cached) {
        return reply.send({ success: true, data: JSON.parse(cached), cached: true });
      }

      // 2. Dates for Today calculations
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      const dateStr = now.toISOString().split('T')[0];

      // 3. Parallel MongoDB & Redis Queries
      const [
        totalProducts,
        lowStockProductIds,
        totalUsers,
        todayOrdersAgg,
        recentOrders,
        visitsStr
      ] = await Promise.all([
        // Total products count
        Product.countDocuments({ status: { $ne: 'archived' } }),

        // Distinct products with low stock (quantityInStock <= 10)
        ProductVariant.distinct('productId', { quantityInStock: { $lte: 10 } }),

        // Total non-admin users
        User.countDocuments({ role: 'USER' }),

        // Today's orders aggregation (revenue + order count)
        Order.aggregate([
          {
            $match: {
              createdAt: { $gte: startOfDay, $lte: endOfDay }
            }
          },
          {
            $group: {
              _id: null,
              totalOrders: { $sum: 1 },
              totalRevenue: {
                $sum: {
                  $cond: [{ $ne: ['$status', 'cancelled'] }, '$totalAmount', 0]
                }
              }
            }
          }
        ]),

        // 10 most recent orders
        Order.find()
          .sort({ createdAt: -1 })
          .limit(10)
          .select('_id shippingInfo totalAmount status createdAt')
          .lean(),

        // Today visits count from Redis
        redis.get(`visits:${dateStr}:default`)
      ]);

      const lowStockCount = lowStockProductIds ? lowStockProductIds.length : 0;
      const todayAggResult = todayOrdersAgg[0] || { totalOrders: 0, totalRevenue: 0 };
      const visitsToday = parseInt(visitsStr || '0', 10);

      const summaryData = {
        totalProducts,
        lowStockCount,
        totalUsers,
        revenueToday: todayAggResult.totalRevenue || 0,
        newOrdersToday: todayAggResult.totalOrders || 0,
        visitsToday,
        recentOrders: recentOrders || []
      };

      // 4. Cache in Redis for 30s
      await redis.set(DashboardStatsController.CACHE_KEY, JSON.stringify(summaryData), 'EX', DashboardStatsController.CACHE_TTL);

      return reply.send({ success: true, data: summaryData, cached: false });
    } catch (error: any) {
      req.log.error(error, 'DashboardStatsController error');
      return reply.status(500).send({ success: false, message: 'Lỗi máy chủ khi tải dữ liệu thống kê' });
    }
  }
}
