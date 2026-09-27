/**
 * Seed tài khoản demo vào collection `users`.
 *
 * Chạy:
 *   npx tsx scripts/seed-users.ts            # tao/cap nhat 50 tai khoan demo (role USER)
 *   npx tsx scripts/seed-users.ts --admin    # tao/cap nhat RIENG tai khoan ADMIN
 *   npx tsx scripts/seed-users.ts --purge    # xoa dung cac tai khoan do script nay sinh (50 demo + admin)
 *
 * Nhan dang: email @seed.local, username seeduser01..seeduser50, SĐT 0999xxxxxx.
 * --purge chi xoa theo danh sách email do, không có đường nào chạm tới tài khoản thật.
 *
 * Admin (mật khẩu khác mật khẩu chung của demo để `Seed@12345` không mở được /admin):
 * email admin@seed.local, username seedadmin, password Admin@Seed123.
 *
 * Chi seed tài khoản, KHÔNG seed địa chỉ: province/district/ward là dữ liệu hành chính
 * thật (xem UserAddress.ts), tự sinh hàng loạt là bịa dữ liệu. Trống địa chỉ thì
 * checkout hiện đúng empty state, đó là hành vi thật của app.
 *
 * Mat khau chung: Seed@12345 — đủ điều kiện RegisterSchema (>=8 ký tự, có chữ + số,
 * src/types/user.types.ts). passwordHash bam rieng tung user bang bcrypt salt 10
 * dung qua hashPassword that cua luong dang ky (src/services/auth/authRegisterService.ts:18),
 * nen dang nhap qua src/services/auth/authSessionService.ts van chay.
 *
 * memberTier/totalSpent/rewardPoints de trong (MEMBER/0/0): hang thanh vien được tính
 * từ đơn hàng thật, đặt số ảo vào là dữ liệu tự mâu thuẫn.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/database.ts';
import { User } from '../src/models/User.ts';
import { hashPassword, comparePassword } from '../src/utils/auth.ts';

const COUNT = 50;
const PASSWORD = 'Seed@12345';
const EMAIL_DOMAIN = '@seed.local';

const HỌ = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Ngô', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Dương', 'Lý'];
const DEM_NỮ = ['Thị', 'Ngọc', 'Thanh', 'Minh', 'Thu', 'Bảo', 'Quỳnh', 'Diễm', 'Hồng', 'Lan'];
const TÊN_NỮ = ['Lan', 'Hương', 'Dung', 'Oanh', 'Trang', 'Nguyệt', 'Hà', 'Mai', 'Thy', 'Giang', 'Nhi', 'Yến', 'Quế', 'Vân', 'Hạnh', 'Đào', 'Thảo', 'Ly', 'Chi', 'Anh'];
const DEM_NAM = ['Văn', 'Nam', 'Thanh', 'Minh', 'Quốc', 'Hải', 'Đức', 'Bảo', 'Ngọc', 'Xuân'];
const TÊN_NAM = ['Hùng', 'Dũng', 'Nam', 'An', 'Khoa', 'Phúc', 'Bình', 'Cường', 'Sơn', 'Long', 'Kiên', 'Tuấn', 'Nghĩa', 'Toàn', 'Duy', 'Khang', 'Minh', 'Quang', 'Thịnh', 'Vũ'];

const pad = (n: number) => String(n).padStart(2, '0');

/** User demo thứ i (0-based) — mọi trường đều suy ra được từ i để chạy lại không đổi dữ liệu. */
function demoUser(i: number) {
  const female = i % 2 === 0;
  const k = Math.floor(i / 2);
  const fullName = [
    HỌ[(i * 7) % HỌ.length],
    (female ? DEM_NỮ : DEM_NAM)[(k * 3) % 10],
    (female ? TÊN_NỮ : TÊN_NAM)[(k * 7) % 20],
  ].join(' ');

  return {
    username: `seeduser${pad(i + 1)}`,
    email: `seeduser${pad(i + 1)}${EMAIL_DOMAIN}`,
    fullName,
    phoneNumber: `0999${String(i + 1).padStart(6, '0')}`,
    gender: female ? 'FEMALE' : 'MALE',
    dateOfBirth: `${1990 + (i % 12)}-${pad(((i * 5) % 12) + 1)}-${pad(((i * 11) % 28) + 1)}`,
  } as const;
}

const SEED_EMAILS = Array.from({ length: COUNT }, (_, i) => demoUser(i).email);

// SĐT 0999000000 nằm ngoài dải 0999xxxxxx của 50 user demo (0999000001..0999000050).
const ADMIN = {
  username: 'seedadmin',
  email: 'admin@seed.local',
  fullName: 'Quản trị viên',
  phoneNumber: '0999000000',
} as const;
const ADMIN_PASSWORD = 'Admin@Seed123';

/**
 * role='ADMIN' là chốt chặn duy nhất của /admin/* (adminAuthMiddleware.ts:32 đọc role
 * từ token, token do authSessionController.ts:52 cấp khi user.role === 'ADMIN'),
 * nên chỉ cần upsert đúng role — không có collection admin riêng.
 */
async function seedAdmin() {
  const existing = await User.find({ role: 'ADMIN' }).select('email username').lean();
  if (existing.length) {
    console.log(`⚠  DB đã có ${existing.length} tài khoản ADMIN: ${existing.map((u) => u.email).join(', ')}`);
  }

  await User.updateOne(
    { email: ADMIN.email },
    {
      $set: {
        ...ADMIN,
        role: 'ADMIN',
        status: 'active',
        passwordHash: await hashPassword(ADMIN_PASSWORD),
      },
      $setOnInsert: { memberTier: 'MEMBER', totalSpent: 0, rewardPoints: 0 },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  const stored = await User.findOne({ email: ADMIN.email }).lean();
  const loginWorks = stored ? await comparePassword(ADMIN_PASSWORD, stored.passwordHash) : false;
  console.log(`\n🔑 Tài khoản quản trị:`);
  console.log(`   ${ADMIN.email}  ${ADMIN.username}  ${ADMIN.fullName}  role=${stored?.role}  status=${stored?.status}`);
  console.log(`   _id: ${stored?._id}`);
  console.log(`   Mật khẩu: ${ADMIN_PASSWORD} — Băm đăng nhập được: ${loginWorks ? 'CÓ' : 'KHÔNG (lỗi!)'}`);
  console.log('   Đăng nhập ở /auth/login rồi vào /admin (role ADMIN được set cả admin_token lẫn session cookie).');
}

async function main() {
  await connectDB();
  // connectDB() nuốt lỗi kết nối (server vẫn boot để /health còn trả lời),
  // còn script này mà connection chưa mở là ghi vào khoảng không.
  if (mongoose.connection.readyState !== 1) {
    throw new Error('Không kết nối được MongoDB — kiểm tra MONGO_URI trong .env');
  }

  const before = await User.countDocuments();

  if (process.argv.includes('--purge')) {
    const { deletedCount } = await User.deleteMany({ email: { $in: [...SEED_EMAILS, ADMIN.email] } });
    console.log(`🗑  Đã xóa ${deletedCount} tài khoản demo. Users: ${before} -> ${await User.countDocuments()}`);
    await mongoose.disconnect();
    process.exit(0);
  }

  if (process.argv.includes('--admin')) {
    await seedAdmin();
    await mongoose.disconnect();
    process.exit(0);
  }

  let created = 0;
  let updated = 0;

  for (let i = 0; i < COUNT; i++) {
    const u = demoUser(i);
    const res = await User.updateOne(
      { email: u.email },
      {
        $set: {
          username: u.username,
          fullName: u.fullName,
          phoneNumber: u.phoneNumber,
          gender: u.gender,
          dateOfBirth: u.dateOfBirth,
          passwordHash: await hashPassword(PASSWORD),
          role: 'USER',
          status: 'active',
        },
        $setOnInsert: { memberTier: 'MEMBER', totalSpent: 0, rewardPoints: 0 },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
    if (res.upsertedCount) created++;
    else updated++;
  }

  const first = demoUser(0);
  const stored = await User.findOne({ email: first.email }).lean();
  const loginWorks = stored ? await comparePassword(PASSWORD, stored.passwordHash) : false;
  const after = await User.countDocuments();

  console.log(`\n👤 50 tài khoản demo — mẫu:`);
  for (const i of [0, 1, 49]) {
    const u = demoUser(i);
    console.log(`   ${u.email.padEnd(28)} ${u.username.padEnd(12)} ${u.fullName.padEnd(24)} ${u.gender.padEnd(6)} ${u.phoneNumber}  ${u.dateOfBirth}`);
  }
  console.log(`\nTạo mới: ${created} | Cập nhật: ${updated}`);
  console.log(`Users: ${before} -> ${after}`);
  console.log(`Băm mật khẩu đăng nhập được không: ${loginWorks ? 'CÓ' : 'KHÔNG (lỗi!)'}`);
  console.log(`Đăng nhập: ${first.email} / ${first.username} — mật khẩu chung: ${PASSWORD}`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
