/**
 * Sửa dữ liệu địa chỉ trong `user_addresses`:
 *
 *   1) XOÁ các doc có userId mồ côi — userId trống hoặc trỏ tới user không tồn tại
 *      (dữ liệu test cũ để lại sau khi user bị xoá, không còn nơi nào đọc tới).
 *   2) Với user active CHƯA có địa chỉ: tạo 1 địa chỉ bằng cách TÁI SỬ DỤNG
 *      địa chỉ đang có trong DB — chỉ mượn phần vị trí (address/ward/district/province),
 *      còn fullName/phoneNumber lấy từ chính user. Không bịa địa danh mới.
 *
 * Chạy:
 *   npx tsx scripts/fix-addresses.ts           # DRY-RUN: chỉ in kế hoạch
 *   npx tsx scripts/fix-addresses.ts --yes     # ghi thật
 *
 * Idempotent: chạy lại bao nhiêu lần cũng chỉ xử lý phần còn thiếu.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { UserAddress } from '../src/models/UserAddress.ts';
import { User } from '../src/models/User.ts';

const WRITE = process.argv.includes('--yes');

async function main() {
  if (!process.env.MONGO_URI) throw new Error('Thiếu MONGO_URI trong .env');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30000 });

  const addresses = (await UserAddress.find().lean()) as any[];
  const users = (await User.find({ status: 'active' }).select('username fullName phoneNumber email role').lean()) as any[];
  const existing = new Set(users.map((u) => String(u._id)));

  const orphan = addresses.filter((a) => !a.userId || !existing.has(String(a.userId)));
  const usable = addresses.filter((a) => a.userId && existing.has(String(a.userId)));

  const taken = new Set(usable.map((a) => String(a.userId)));
  const need = users.filter((u) => !taken.has(String(u._id)));

  console.log(`\n📍 Tổng địa chỉ: ${addresses.length}`);
  console.log(`  - userId mồ côi (sẽ XOÁ)     : ${orphan.length}`);
  console.log(`  - địa chỉ còn dùng được       : ${usable.length}`);
  console.log(`  - user active chưa có địa chỉ : ${need.length}`);

  if (orphan.length) {
    console.log('\n--- Mẫu địa chỉ mồ côi sẽ bị xoá ---');
    orphan.slice(0, 5).forEach((a) =>
      console.log(`    userId=${a.userId || '(thiếu)'} | ${a.address || '-'}, ${a.ward || '-'}, ${a.district || '-'}, ${a.province || '-'}`),
    );
  }

  if (!usable.length && need.length) {
    throw new Error('Không có địa chỉ nào để tái sử dụng — hãy seed địa chỉ trước.');
  }

  const plan = need.map((u, i) => {
    const src = usable[i % usable.length];
    return {
      userId: u._id,
      addressType: 'home',
      fullName: u.fullName || u.username,
      phoneNumber: u.phoneNumber || '',
      address: src.address || '',
      ward: src.ward || '',
      district: src.district || '',
      province: src.province || '',
      latitude: src.latitude,
      longitude: src.longitude,
      isDefault: true,
    };
  });

  if (need.length) {
    console.log(`\n--- Mẫu địa chỉ tái sử dụng cho user chưa có (${need.length}) ---`);
    plan.slice(0, 5).forEach((p) =>
      console.log(`    ${String(p.fullName).padEnd(14)} → ${p.address || '(không số nhà)'}, ${p.ward}, ${p.district}, ${p.province}`),
    );
  }

  if (!WRITE) {
    console.log('\nDRY-RUN: chưa ghi gì. Thêm --yes để áp dụng.');
    return;
  }

  const deleted = orphan.length
    ? (await UserAddress.deleteMany({ _id: { $in: orphan.map((a) => a._id) } })).deletedCount || 0
    : 0;
  const created = plan.length ? await UserAddress.insertMany(plan) : [];

  console.log(`\n✅ Đã XOÁ ${deleted} địa chỉ mồ côi | đã tạo ${created.length} địa chỉ tái sử dụng.`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
