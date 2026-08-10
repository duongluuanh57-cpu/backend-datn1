/**
 * Migration script: Xóa toàn bộ ảnh sản phẩm trong Product.image và ProductImage collection
 *
 * Cách chạy:
 *   npx tsx scripts/clear-product-images.ts
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

  // --- Xóa image field trên Product ---
  const productsCol = db.collection('products');
  const prodBefore = await productsCol.countDocuments({ image: { $exists: true, $ne: '' } });
  console.log(`📊 Số products có image: ${prodBefore}`);

  if (prodBefore > 0) {
    const prodResult = await productsCol.updateMany(
      { image: { $exists: true, $ne: '' } },
      { $unset: { image: '' } }
    );
    console.log(`🗑️  Đã xóa image field khỏi ${prodResult.modifiedCount} products`);
  }

  const prodAfter = await productsCol.countDocuments({ image: { $exists: true, $ne: '' } });
  console.log(`📊 Products còn image: ${prodAfter}`);

  // --- Xóa toàn bộ ProductImage documents ---
  const prodImgCol = db.collection('product_images');
  const imgBefore = await prodImgCol.countDocuments();
  console.log(`📊 Số ProductImage documents: ${imgBefore}`);

  if (imgBefore > 0) {
    const imgResult = await prodImgCol.deleteMany({});
    console.log(`🗑️  Đã xóa ${imgResult.deletedCount} ProductImage documents`);
  }

  const imgAfter = await prodImgCol.countDocuments();
  console.log(`📊 ProductImage còn lại: ${imgAfter}`);

  await mongoose.disconnect();
  console.log('✅ Hoàn tất.');
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Lỗi:', err);
  process.exit(1);
});
