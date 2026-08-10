import 'dotenv/config';
import mongoose from 'mongoose';
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

  console.log(`  ${fmtDate(date)}: ${agg.totalOrders} orders, ${Math.round(agg.totalRevenue).toLocaleString()} revenue`);
}

async function seed() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGO_URI is not defined');

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
  });
  console.log(`Connected: ${mongoose.connection.host}\n`);

  // Tìm ngày xa nhất và gần nhất trong orders
  const [oldest] = await Order.find().sort({ createdAt: 1 }).limit(1).lean();
  const [newest] = await Order.find().sort({ createdAt: -1 }).limit(1).lean();

  if (!oldest || !newest) {
    console.log('❌ Không có đơn hàng nào trong database.');
    await mongoose.disconnect();
    process.exit(0);
  }

  const startDate = new Date(oldest.createdAt);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(newest.createdAt);
  endDate.setHours(23, 59, 59, 999);

  console.log(`📅 Tổng hợp DailySummary từ ${fmtDate(startDate)} đến ${fmtDate(endDate)}...\n`);

  // Xoá dữ liệu cũ trong khoảng này
  await DailySummaryReport.deleteMany({
    date: { $gte: startDate, $lte: endDate },
  });
  console.log(`🗑️  Đã xoá DailySummary cũ trong khoảng này\n`);

  // Tổng hợp từng ngày
  let count = 0;
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    await aggregateDay(new Date(d));
    count++;
  }

  console.log(`\n✅ Done! Đã tổng hợp ${count} ngày.`);
  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});