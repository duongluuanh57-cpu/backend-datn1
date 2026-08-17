import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { connectDB } from '../config/database.ts';
import { Review } from '../models/Review.ts';
import { User } from '../models/User.ts';

async function main() {
  console.log('🔧 Seed người duyệt cho toàn bộ review');

  await connectDB();

  const admins = await User.find({ role: 'ADMIN' }).select('username').lean();
  if (admins.length === 0) {
    console.error('❌ Không tìm thấy admin nào trong hệ thống');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`👤 Admins: ${admins.map((a: any) => a.username).join(', ')}`);

  const reviews = await Review.find({}).lean();
  console.log(`📋 Tổng số review: ${reviews.length}`);

  let updated = 0;
  let aiCount = 0;
  let adminCount = 0;

  for (let i = 0; i < reviews.length; i++) {
    const review = reviews[i];
    const isAi = review.aiRejected || review.status === 'rejected';

    let moderatedBy: string;
    let moderatedByType: 'admin' | 'ai';

    if (isAi) {
      moderatedBy = 'AI';
      moderatedByType = 'ai';
      aiCount++;
    } else {
      const admin = admins[i % admins.length] as any;
      moderatedBy = admin?.username || 'Admin';
      moderatedByType = 'admin';
      adminCount++;
    }

    if (review.moderatedBy !== moderatedBy || review.moderatedByType !== moderatedByType) {
      await Review.updateOne(
        { _id: review._id },
        { $set: { moderatedBy, moderatedByType, ...(isAi ? { aiRejected: true } : {}) } }
      );
      updated++;
    }
  }

  console.log(`✅ Đã cập nhật: ${updated}`);
  console.log(`   - Người duyệt AI: ${aiCount}`);
  console.log(`   - Người duyệt Admin: ${adminCount}`);

  await mongoose.disconnect();
  console.log('🍃 Done. Disconnected.');
  process.exit(0);
}

main().catch(async (err) => {
  console.error('❌ Lỗi khi chạy script:', err);
  await mongoose.disconnect();
  process.exit(1);
});
