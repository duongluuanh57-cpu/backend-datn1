/**
 * Migration: Thêm field `isSupplemented` + `status` cho sản phẩm cũ chưa có
 *
 * Chạy: npx tsx scripts/migrations/add-supplement-fields.ts
 *
 * Logic:
 * - Sản phẩm cũ đã có đủ thông tin → isSupplemented: true, status: 'active'
 * - Sản phẩm mới tạo qua AI chat đã có 2 field (default: false + 'draft') → bỏ qua
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env from backend-datn root (2 levels up from scripts/migrations/)
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '..', '.env') });

import mongoose from 'mongoose';

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ MONGO_URI is not defined in environment variables');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('🍃 MongoDB connected');

  const db = mongoose.connection.db;
  if (!db) throw new Error('db is undefined');

  // Chỉ update sản phẩm CHƯA có field isSupplemented
  const result = await db
    .collection('products')
    .updateMany(
      { isSupplemented: { $exists: false } },
      { $set: { isSupplemented: true, status: 'active' } },
    );

  console.log(`✅ Đã thêm isSupplemented + status cho ${result.modifiedCount} sản phẩm cũ`);
  await mongoose.disconnect();
  console.log('✅ Done');
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});