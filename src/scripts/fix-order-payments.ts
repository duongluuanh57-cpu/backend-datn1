import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { connectDB } from '../config/database.ts';
import { Order } from '../models/Order.ts';

async function main() {
  console.log('🔧 Fix order payments: delivered but unpaid → paid');

  await connectDB();

  const result = await Order.updateMany(
    { status: 'delivered', paymentStatus: 'unpaid' },
    { $set: { paymentStatus: 'paid' } }
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
