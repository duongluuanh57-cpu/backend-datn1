import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { connectDB } from '../config/database.ts';
import { Order } from '../models/Order.ts';
import { User } from '../models/User.ts';
import { UserAddress } from '../models/UserAddress.ts';

const VN_PHONE_PREFIXES = ['090', '091', '098', '097', '086', '079', '077', '038', '039', '035', '032'];

function generateRandomVNPhone(): string {
  const prefix = VN_PHONE_PREFIXES[Math.floor(Math.random() * VN_PHONE_PREFIXES.length)];
  const suffix = Math.floor(1000000 + Math.random() * 9000000).toString().substring(0, 7);
  return `${prefix}${suffix}`;
}

async function main() {
  console.log('📱 Bắt đầu seed số điện thoại cho các đơn hàng chưa có SĐT...');

  await connectDB();

  // Tìm tất cả đơn hàng mà shippingInfo.customerPhone chưa có hoặc rỗng
  const ordersToUpdate = await Order.find({
    $or: [
      { 'shippingInfo.customerPhone': { $exists: false } },
      { 'shippingInfo.customerPhone': null },
      { 'shippingInfo.customerPhone': '' },
    ],
  })
    .select('_id userId shippingInfo')
    .lean();

  console.log(`📦 Tìm thấy ${ordersToUpdate.length} đơn hàng cần cập nhật SĐT.`);

  if (ordersToUpdate.length === 0) {
    console.log('✅ Tất cả đơn hàng đã có số điện thoại.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // Thu thập danh sách userId duy nhất để fetch 1 lần
  const userIds = [
    ...new Set(ordersToUpdate.map((o) => o.userId?.toString()).filter(Boolean)),
  ].map((id) => new mongoose.Types.ObjectId(id as string));

  const [users, addresses] = await Promise.all([
    User.find({ _id: { $in: userIds } })
      .select('_id phoneNumber')
      .lean(),
    UserAddress.find({ userId: { $in: userIds }, isDefault: true })
      .select('userId phoneNumber')
      .lean(),
  ]);

  const userPhoneMap = new Map<string, string>();
  for (const u of users) {
    if (u.phoneNumber && u.phoneNumber.trim()) {
      userPhoneMap.set(u._id.toString(), u.phoneNumber.trim());
    }
  }

  const addressPhoneMap = new Map<string, string>();
  for (const a of addresses) {
    if (a.phoneNumber && a.phoneNumber.trim()) {
      addressPhoneMap.set(a.userId.toString(), a.phoneNumber.trim());
    }
  }

  const bulkOps = ordersToUpdate.map((order) => {
    const uid = order.userId?.toString();
    const phone =
      (uid && (userPhoneMap.get(uid) || addressPhoneMap.get(uid))) ||
      generateRandomVNPhone();

    return {
      updateOne: {
        filter: { _id: order._id },
        update: { $set: { 'shippingInfo.customerPhone': phone } },
      },
    };
  });

  const res = await Order.bulkWrite(bulkOps);

  console.log(`✅ Bulk write hoàn tất: Đã cập nhật ${res.modifiedCount} đơn hàng!`);

  await mongoose.disconnect();
  console.log('🍃 Hoàn tất và đã ngắt kết nối database.');
  process.exit(0);
}

main().catch(async (err) => {
  console.error('❌ Lỗi khi chạy script:', err);
  await mongoose.disconnect();
  process.exit(1);
});
