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
          $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, '$totalAmount', 0] },
        },
        totalOrders: { $sum: 1 },
        completedOrders: {
          $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, 1, 0] },
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

  // Backfill: fill 90 ngày gần nhất khi server khởi động (chạy bất đồng bộ)
  setTimeout(async () => {
    const now = new Date();
    const existing = await DailySummaryReport.findOne().sort({ date: -1 }).lean();
    const lastDate = existing?.date ? new Date(existing.date) : null;

    if (!lastDate) {
      // Chưa có dữ liệu → fill 90 ngày
      for (let i = 90; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        await aggregateDay(d);
      }
      console.log('[DailySummary] Backfill completed (90 days)');
    } else if (lastDate < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)) {
      // Còn thiếu vài ngày
      const start = new Date(lastDate);
      start.setDate(start.getDate() + 1);
      const end = new Date(now);
      end.setDate(end.getDate() - 1);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        await aggregateDay(new Date(d));
      }
      console.log('[DailySummary] Gap filled');
    }
  }, 5000);
}
