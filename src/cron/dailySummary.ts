import cron from 'node-cron';
import { Order } from '../models/Order.ts';
import { DailySummaryReport } from '../models/DailySummaryReport.ts';

function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

async function aggregateDay(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  const result = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: null,
        totalRevenue: {
          $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, '$totalAmount', 0] },
        },
        totalOrders: {
          $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, 1, 0] },
        },
        completedOrders: {
          $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] },
        },
        cancelledRevenue: {
          $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, '$totalAmount', 0] },
        },
      },
    },
  ]);

  const agg = result[0] || { totalRevenue: 0, totalOrders: 0, completedOrders: 0, cancelledRevenue: 0 };

  await DailySummaryReport.findOneAndUpdate(
    { date: start },
    {
      $set: {
        totalRevenue: Math.round(agg.totalRevenue),
        totalOrders: agg.totalOrders,
        completedOrders: agg.completedOrders,
        cancelledRevenue: Math.round(agg.cancelledRevenue),
      },
    },
    { upsert: true }
  );

  console.log(`[DailySummary] Aggregated ${fmtDate(date)}: ${agg.totalOrders} orders, ${Math.round(agg.totalRevenue).toLocaleString()} revenue`);
}

export function startDailySummaryCron() {
  // Chạy lúc 00:05 mỗi ngày
  cron.schedule('5 0 * * *', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await aggregateDay(yesterday);
  });

  // Luôn làm mới dữ liệu 90 ngày gần nhất khi server khởi động
  setTimeout(async () => {
    try {
      const now = new Date();
      for (let i = 90; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        await aggregateDay(d);
      }
      console.log('[DailySummary] Backfill & refresh completed (90 days)');
    } catch (err) {
      console.error('[DailySummary] Backfill error:', err);
    }
  }, 2000);
}
