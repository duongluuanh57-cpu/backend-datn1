import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { connectDB } from '../config/database.ts';
import { Review } from '../models/Review.ts';

async function main() {
  console.log('🔧 Backfill aiRejected cho review đã bị AI từ chối (status=rejected, có rejectionReason)');

  await connectDB();

  const result = await Review.updateMany(
    { status: 'rejected', rejectionReason: { $ne: '' }, aiRejected: { $ne: true } },
    { $set: { aiRejected: true } }
  );

  console.log(`📦 Matched: ${result.matchedCount}`);
  console.log(`✅ Modified: ${result.modifiedCount}`);

  await mongoose.disconnect();
  console.log('🍃 Done. Disconnected.');
  process.exit(0);
}

main().catch(async (err) => {
  console.error('❌ Lỗi khi chạy script:', err);
  await mongoose.disconnect();
  process.exit(1);
});
