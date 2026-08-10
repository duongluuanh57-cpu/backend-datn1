import 'dotenv/config';
import mongoose from 'mongoose';

async function migrate() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is not defined in environment variables');
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
  });
  console.log(`Connected: ${mongoose.connection.host}\n`);

  const db = mongoose.connection.db!;
  const coll = db.collection('orders');

  const filter = { cancelRequested: true, status: 'cancelled' };
  const badCount = await coll.countDocuments(filter);
  console.log(`orders — ${badCount} document(s) có yêu cầu hủy nhưng trạng thái Đã hủy`);

  if (badCount === 0) {
    console.log('Không có dữ liệu cần sửa.');
    await mongoose.disconnect();
    return;
  }

  // Đơn có yêu cầu hủy phải giữ trạng thái ban đầu (pending) để admin xử lý
  const result = await coll.updateMany(filter, { $set: { status: 'pending' } });
  console.log(`  ✔ Đổi ${result.modifiedCount} đơn sang trạng thái pending (giữ cờ cancelRequested)`);

  console.log('\n✅ Done.');
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
