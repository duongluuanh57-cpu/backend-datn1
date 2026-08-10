import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../models/User.ts';

const FULL_NAMES_MALE = [
  'Nguyễn Văn Anh', 'Trần Văn Bình', 'Lê Văn Cường', 'Phạm Văn Dũng', 'Hoàng Văn Hải',
  'Huỳnh Văn Hùng', 'Phan Văn Khanh', 'Vũ Văn Long', 'Đặng Văn Minh', 'Bùi Văn Nam',
  'Đỗ Văn Quân', 'Hồ Văn Sơn', 'Ngô Văn Thắng', 'Dương Văn Thành', 'Lý Văn Việt',
  'Mai Văn Tâm', 'Đinh Văn Phúc', 'Trịnh Văn Đức', 'Lương Văn Tài', 'Cao Văn Lộc',
  'Nguyễn Văn Phương', 'Trần Văn Trung', 'Lê Văn Kiên', 'Phạm Văn Huy', 'Hoàng Văn Đạt',
  'Huỳnh Văn Tiến', 'Phan Văn Bảo', 'Vũ Văn Khang', 'Đặng Văn Phát', 'Bùi Văn Nhân',
  'Đỗ Văn Trọng', 'Hồ Văn Hiếu', 'Ngô Văn Tùng', 'Dương Văn Lâm', 'Lý Văn Hoàng',
  'Mai Văn Duy', 'Đinh Văn Khôi', 'Trịnh Văn Vũ', 'Lương Văn Hòa', 'Cao Văn Nghĩa',
  'Nguyễn Văn Tú', 'Trần Văn Quyết', 'Lê Văn Chí', 'Phạm Văn Hào', 'Hoàng Văn Lợi',
  'Huỳnh Văn Sang', 'Phan Văn Thuận', 'Vũ Văn Công', 'Đặng Văn Thịnh', 'Bùi Văn Đông',
];

const FULL_NAMES_FEMALE = [
  'Nguyễn Thị An', 'Trần Thị Bích', 'Lê Thị Cẩm', 'Phạm Thị Dung', 'Hoàng Thị Hà',
  'Huỳnh Thị Hương', 'Phan Thị Khanh', 'Vũ Thị Lan', 'Đặng Thị Linh', 'Bùi Thị Mai',
  'Đỗ Thị Ngọc', 'Hồ Thị Nhung', 'Ngô Thị Phương', 'Dương Thị Quỳnh', 'Lý Thị Trang',
  'Mai Thị Thảo', 'Đinh Thị Tuyết', 'Trịnh Thị Vân', 'Lương Thị Yến', 'Cao Thị Hồng',
  'Nguyễn Thị Ánh', 'Trần Thị Diễm', 'Lê Thị Giang', 'Phạm Thị Hạnh', 'Hoàng Thị Kim',
  'Huỳnh Thị Liên', 'Phan Thị Mỹ', 'Vũ Thị Nga', 'Đặng Thị Oanh', 'Bùi Thị Phượng',
  'Đỗ Thị Sương', 'Hồ Thị Thanh', 'Ngô Thị Thúy', 'Dương Thị Trúc', 'Lý Thị Tú',
  'Mai Thị Uyên', 'Đinh Thị Vy', 'Trịnh Thị Xuân', 'Lương Thị Đào', 'Cao Thị Hoa',
  'Nguyễn Thị Hải', 'Trần Thị Hậu', 'Lê Thị Huế', 'Phạm Thị Hợp', 'Hoàng Thị Lệ',
  'Huỳnh Thị Nhi', 'Phan Thị Phi', 'Vũ Thị Tâm', 'Đặng Thị Tiên', 'Bùi Thị Trinh',
];

const PHONES = [
  '090', '091', '092', '093', '094', '096', '097', '098', '099',
  '032', '033', '034', '035', '036', '037', '038', '039',
  '070', '076', '077', '078', '079', '081', '082', '083', '084', '085', '086', '087', '088', '089',
];

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randomPick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomPhone() {
  return randomPick(PHONES) + String(randomInt(1000000, 9999999));
}

async function update() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGO_URI is not defined');

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
  });
  console.log(`Connected: ${mongoose.connection.host}\n`);

  const allNames = [...FULL_NAMES_MALE, ...FULL_NAMES_FEMALE];
  const users = await User.find({}).lean();
  console.log(`👤 Found ${users.length} users to update\n`);

  let updated = 0;
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const fullName = allNames[i % allNames.length];
    const isMale = FULL_NAMES_MALE.includes(fullName);
    const gender = isMale ? 'MALE' : 'FEMALE';
    const phone = randomPhone();

    // Tạo username từ tên thật: "Nguyễn Văn Anh" → "nguyen_van_anh"
    const username = fullName
      .toLowerCase()
      .replace(/đ/g, 'd')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '_');

    // Tạo email từ tên thật: "Nguyễn Văn Anh" → "nguyen.van.anh@perfume.com"
    const email = username + '@perfume.com';

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          username,
          email,
          fullName,
          phoneNumber: phone,
          gender,
        },
      }
    );
    console.log(`   [${i + 1}] ${fullName} → ${username} (${phone})`);
    updated++;
  }

  console.log(`\n✅ Updated ${updated} users with real names!`);
  await mongoose.disconnect();
}

update().catch(err => {
  console.error('❌ Failed:', err);
  process.exit(1);
});