/**
 * Migration: Xóa field `rating` khỏi tất cả document trong collection `products`
 * Chạy: npx tsx scripts/migrations/remove-rating.ts
 */
import 'dotenv/config';
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

  const result = await db
    .collection('products')
    .updateMany({}, { $unset: { rating: '' } });

  console.log(`✅ Xóa field "rating" khỏi ${result.modifiedCount} document(s)`);
  await mongoose.disconnect();
  console.log('✅ Done');
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});