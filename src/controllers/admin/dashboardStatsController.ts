import type { FastifyRequest, FastifyReply } from 'fastify';
import { Product } from '../../models/Product.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { Order } from '../../models/Order.ts';
import { OrderItem } from '../../models/OrderItem.ts';
import { User } from '../../models/User.ts';
import { redis } from '../../config/redis.ts';
import { z } from 'zod';

// Múi giờ VN (UTC+7): mọi bucket "ngày/giờ" quy về lịch VN để số liệu
// hôm-nay/hôm-qua và biểu đồ giờ không lệch 7 tiếng so với người dùng.
const VN_TZ = '+07:00';
const VN_OFFSET_MS = 7 * 3600 * 1000;
function vnDayBounds(dayOffset: number): { start: Date; end: Date } {
  const shifted = new Date(Date.now() + VN_OFFSET_MS + dayOffset * 86400000);
  const y = shifted.getUTCFullYear();
  const mo = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  const start = new Date(Date.UTC(y, mo, d) - VN_OFFSET_MS);
  const end = new Date(start.getTime() + 86400000 - 1);
  return { start, end };
}

export class DashboardStatsController {
  private static CACHE_KEY = 'admin:dashboard:summary_kpis_v2';
  private static CACHE_TTL = 30; // 30 seconds

  static async getSummaryStats(req: FastifyRequest, reply: FastifyReply) {
    try {
      // 1. Try reading from Redis cache
      const cached = await redis.get(DashboardStatsController.CACHE_KEY);
      if (cached) {
        return reply.send({ success: true, data: JSON.parse(cached), cached: true });
      }

      // 2. Dates for Today & Yesterday calculations (theo lịch VN)
      const { start: startOfDay, end: endOfDay } = vnDayBounds(0);
      const { start: startOfYesterday, end: endOfYesterday } = vnDayBounds(-1);

      // 3. Parallel MongoDB & Redis Queries
      const [
        totalProducts,
        lowStockProductIds,
        totalUsers,
        todayOrdersAgg,
        yesterdayOrdersAgg,
        recentOrders
      ] = await Promise.all([
        // Total products count
        Product.countDocuments({ status: { $ne: 'archived' } }),

        // Distinct ACTIVE products with low stock (quantityInStock <= 10)
        // — khớp phạm vi với totalProducts (không đếm hàng archived/inactive).
        (async () => {
          const activeProductIds = await Product.find({ status: 'active' }).select('_id').lean();
          const activeIdSet = new Set(activeProductIds.map((p) => p._id.toString()));
          const ids = await ProductVariant.distinct('productId', { quantityInStock: { $lte: 10 } });
          return (ids || []).filter((id: any) => id && activeIdSet.has(String(id)));
        })(),

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
              totalOrders: {
                $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, 1, 0] }
              },
              totalRevenue: {
                $sum: {
                  $cond: [{ $eq: ['$status', 'delivered'] }, '$totalAmount', 0]
                }
              }
            }
          }
        ]),

        // Yesterday's orders aggregation
        Order.aggregate([
          {
            $match: {
              createdAt: { $gte: startOfYesterday, $lte: endOfYesterday }
            }
          },
          {
            $group: {
              _id: null,
              totalOrders: {
                $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, 1, 0] }
              },
              totalRevenue: {
                $sum: {
                  $cond: [{ $eq: ['$status', 'delivered'] }, '$totalAmount', 0]
                }
              }
            }
          }
        ]),

        // 10 most recent orders (bỏ đơn đã hủy)
        Order.find({ status: { $ne: 'cancelled' } })
          .sort({ createdAt: -1 })
          .limit(10)
          .select('_id shippingInfo userId totalAmount status createdAt')
          .populate({ path: 'userId', select: 'username email fullName' })
          .lean()
      ]);

      const lowStockCount = lowStockProductIds ? lowStockProductIds.length : 0;
      const todayAggResult = todayOrdersAgg[0] || { totalOrders: 0, totalRevenue: 0 };
      const yesterdayAggResult = yesterdayOrdersAgg[0] || { totalOrders: 0, totalRevenue: 0 };

      // Dynamic growth percentage calculation vs Yesterday
      let revenueChangePct: number | null = null;
      if (yesterdayAggResult.totalRevenue > 0) {
        revenueChangePct = parseFloat((((todayAggResult.totalRevenue - yesterdayAggResult.totalRevenue) / yesterdayAggResult.totalRevenue) * 100).toFixed(1));
      }

      let ordersChangePct: number | null = null;
      if (yesterdayAggResult.totalOrders > 0) {
        ordersChangePct = parseFloat((((todayAggResult.totalOrders - yesterdayAggResult.totalOrders) / yesterdayAggResult.totalOrders) * 100).toFixed(1));
      }

      const summaryData = {
        totalProducts,
        lowStockCount,
        totalUsers,
        revenueToday: todayAggResult.totalRevenue || 0,
        newOrdersToday: todayAggResult.totalOrders || 0,
        revenueYesterday: yesterdayAggResult.totalRevenue || 0,
        ordersYesterday: yesterdayAggResult.totalOrders || 0,
        revenueChangePct,
        ordersChangePct,
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

  static async getSalesTrend(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { days = '7' } = req.query as { days?: string };
      const nDays = Math.min(Math.max(parseInt(days) || 7, 1), 90);
      const startDate = vnDayBounds(-(nDays - 1)).start;

      // Doanh thu theo ngày = đơn GIAO THÀNH công, khớp định nghĩa với KPI
      // revenueToday; bucket theo lịch VN (+07:00).
      const data = await Order.aggregate([
        { $match: { status: 'delivered', createdAt: { $gte: startDate } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: VN_TZ } }, totalRevenue: { $sum: '$totalAmount' } } },
        { $sort: { _id: 1 } }
      ]);

      return reply.send({ success: true, data });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  static async getTopBrands(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { days = '30' } = req.query as { days?: string };
      const nDays = Math.min(Math.max(parseInt(days) || 30, 1), 90);
      const startDate = vnDayBounds(-(nDays - 1)).start;

      const data = await OrderItem.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        // Chỉ tính dòng thuộc đơn GIAO THÀNH → doanh thu theo brand khớp KPI,
        // không cộng đơn pending/đã hủy (Hủy đơn không xóa OrderItem).
        {
          $lookup: {
            from: 'orders',
            localField: 'orderId',
            foreignField: '_id',
            as: 'order',
            pipeline: [{ $match: { status: 'delivered' } }, { $project: { _id: 1 } }],
          },
        },
        { $match: { order: { $ne: [] } } },
        { $project: { orderId: 0, order: 0 } },
        { $lookup: { from: 'product_variants', localField: 'productVariantId', foreignField: '_id', as: 'variant' } },
        { $unwind: '$variant' },
        { $lookup: { from: 'products', localField: 'variant.productId', foreignField: '_id', as: 'product' } },
        { $unwind: '$product' },
        { $lookup: { from: 'brands', localField: 'product.brandId', foreignField: '_id', as: 'brand' } },
        { $unwind: '$brand' },
        { $group: { _id: '$brand.name', revenue: { $sum: { $multiply: ['$price', '$quantity'] } } } },
        { $sort: { revenue: -1 } },
        { $limit: 10 }
      ]);

      return reply.send({ success: true, data: data.filter(b => b._id) });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  static async getHourlySales(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { days = '7' } = req.query as { days?: string };
      const nDays = Math.min(Math.max(parseInt(days) || 7, 1), 90);
      const startDate = vnDayBounds(-(nDays - 1)).start;

      const data = await OrderItem.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $lookup: {
            from: 'orders',
            localField: 'orderId',
            foreignField: '_id',
            as: 'order',
            pipeline: [{ $match: { status: 'delivered' } }, { $project: { _id: 1 } }],
          },
        },
        { $match: { order: { $ne: [] } } },
        { $group: { _id: { $hour: { date: '$createdAt', timezone: VN_TZ } }, revenue: { $sum: { $multiply: ['$price', '$quantity'] } } } },
        { $sort: { _id: 1 } }
      ]);

      return reply.send({ success: true, data });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }
}
