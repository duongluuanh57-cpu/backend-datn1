/**
 * Migration script: Xóa field `totalSpent` khỏi collection users
 * 
 * Cách chạy:
 *   npx tsx scripts/remove-totalSpent.ts
 *
 * Yêu cầu: file .env có MONGO_URI hợp lệ
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/your-db';

async function run() {
  console.log('🔌 Đang kết nối MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('✅ Đã kết nối');

  const db = mongoose.connection.db;
  if (!db) {
    console.error('❌ Không thể lấy database instance');
    process.exit(1);
  }

  const col = db.collection('users');

  // Đếm số documents có field totalSpent
  const beforeCount = await col.countDocuments({ totalSpent: { $exists: true } });
  console.log(`📊 Số documents có field totalSpent: ${beforeCount}`);

  if (beforeCount === 0) {
    console.log('✅ Không có document nào cần xóa. Done.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // Xóa field totalSpent khỏi tất cả documents
  const result = await col.updateMany(
    { totalSpent: { $exists: true } },
    { $unset: { totalSpent: '' } }
  );

  console.log(`🗑️  Đã xóa totalSpent khỏi ${result.modifiedCount} documents`);

  // Verify
  const afterCount = await col.countDocuments({ totalSpent: { $exists: true } });
  console.log(`📊 Còn lại: ${afterCount} documents`);

  await mongoose.disconnect();
  console.log('✅ Hoàn tất.');
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Lỗi:', err);
  process.exit(1);
});