/**
 * Kiểm tra số lượng người dùng trên DB và vài chỉ số liên quan.
 *
 * Chạy: npx tsx scripts/check-users.ts
 *
 * Chỉ ĐỌC — không sửa gì. In ra:
 *   - tổng số user, tách theo role / status / hạng thành viên
 *   - số user có / không có địa chỉ đã lưu (và userId mồ côi nếu có)
 *   - số user có / không có đơn, số đơn trung bình
 *   - top 10 chi tiêu (users.totalSpent)
 *   - đối chiếu users.totalSpent + memberTier với tổng đơn delivered
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../src/models/User.ts';
import { UserAddress } from '../src/models/UserAddress.ts';
import { Order } from '../src/models/Order.ts';
import { computeMemberTier } from '../src/utils/memberTier.ts';

const money = (n: number) => (Number(n) || 0).toLocaleString('vi-VN');

async function main() {
  if (!process.env.MONGO_URI) throw new Error('Thiếu MONGO_URI trong .env');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30000 });

  const total = await User.countDocuments();
  console.log(`\n👥 Tổng người dùng: ${total}`);

  const group = (field: string) =>
    User.aggregate([{ $group: { _id: `$${field}`, n: { $sum: 1 } } }, { $sort: { n: -1 } }]);

  console.log('\n=== Theo role ===');
  for (const r of (await group('role')) as any[]) console.log(`  ${String(r._id ?? '(trống)').padEnd(8)} : ${r.n}`);

  console.log('\n=== Theo trạng thái ===');
  for (const r of (await group('status')) as any[]) console.log(`  ${String(r._id ?? '(trống)').padEnd(10)} : ${r.n}`);

  console.log('\n=== Theo hạng thành viên ===');
  for (const r of (await group('memberTier')) as any[]) console.log(`  ${String(r._id ?? '(trống)').padEnd(10)} : ${r.n}`);

  const addressUserIds = new Set((await UserAddress.distinct('userId')).map(String));
  const allUserIds = new Set((await User.distinct('_id')).map(String));
  const withAddr = [...addressUserIds].filter((id) => allUserIds.has(id)).length;
  const orphanAddr = addressUserIds.size - withAddr;
  console.log('\n=== Địa chỉ đã lưu ===');
  console.log(`  user có địa chỉ    : ${withAddr}`);
  console.log(`  user không có      : ${Math.max(0, total - withAddr)}`);
  console.log(`  tổng địa chỉ       : ${await UserAddress.countDocuments()}`);
  if (orphanAddr > 0) console.log(`  ⚠ userId mồ côi     : ${orphanAddr} (địa chỉ trỏ tới user không tồn tại)`);

  const orderAgg = (await Order.aggregate([
    {
      $group: {
        _id: '$userId',
        n: { $sum: 1 },
        delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
        spent: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, '$totalAmount', 0] } },
      },
    },
  ])) as any[];

  const orderUsers = orderAgg.length;
  const totalOrders = orderAgg.reduce((s, r) => s + r.n, 0);
  const totalDelivered = orderAgg.reduce((s, r) => s + (r.delivered || 0), 0);
  console.log('\n=== Đơn hàng theo user ===');
  console.log(`  user có đơn        : ${orderUsers}`);
  console.log(`  user chưa có đơn   : ${Math.max(0, total - orderUsers)}`);
  console.log(`  tổng đơn           : ${totalOrders} (delivered: ${totalDelivered})`);
  console.log(`  đơn TB / user có đơn: ${orderUsers ? (totalOrders / orderUsers).toFixed(1) : '0'}`);

  const spendMap = new Map<string, number>(orderAgg.map((r) => [String(r._id), r.spent as number]));

  const topUsers = (await User.find()
    .select('username email totalSpent memberTier')
    .sort({ totalSpent: -1 })
    .limit(10)
    .lean()) as any[];
  console.log('\n=== Top 10 chi tiêu (users.totalSpent) ===');
  topUsers.forEach((u, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)}. ${money(u.totalSpent).padStart(14)}đ | ${String(u.memberTier).padEnd(8)} | ${String(u.username).padEnd(14)} ${u.email}`,
    );
  });

  const allUsers = (await User.find().select('username totalSpent memberTier').lean()) as any[];
  let mismatch = 0;
  const samples: string[] = [];
  for (const u of allUsers) {
    const computed = spendMap.get(String(u._id)) || 0;
    const expectedTier = computeMemberTier(computed);
    if ((u.totalSpent || 0) !== computed || u.memberTier !== expectedTier) {
      mismatch++;
      if (samples.length < 8) {
        samples.push(
          `    ${String(u.username).padEnd(14)} totalSpent ${money(u.totalSpent).padStart(12)} vs delivered ${money(computed).padStart(12)} | tier ${u.memberTier} vs ${expectedTier}`,
        );
      }
    }
  }
  console.log('\n=== Đối chiếu totalSpent / memberTier với đơn delivered ===');
  console.log(`  user lệch          : ${mismatch}/${total}`);
  samples.forEach((s) => console.log(s));
  if (mismatch > 0) console.log('  (chạy lại luồng đồng bộ hạng, hoặc seed đơn để khớp)');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
