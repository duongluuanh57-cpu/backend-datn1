import 'dotenv/config';
import mongoose from 'mongoose';

async function seed() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGO_URI is not defined');

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
  });
  console.log(`Connected: ${mongoose.connection.host}\n`);

  const db = mongoose.connection.db!;
  const vouchers = db.collection('vouchers');

  const now = new Date();
  const startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
  const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days later

  const testVouchers = [
    {
      code: 'WELCOME10',
      type: 'percentage',
      value: 10,
      scope: 'shop',
      userId: null,
      minOrderAmount: 100000,
      maxDiscount: 50000,
      maxUsage: 0,
      usedCount: 0,
      startDate,
      endDate,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      code: 'GIAM30K',
      type: 'fixed',
      value: 30000,
      scope: 'shop',
      userId: null,
      minOrderAmount: 200000,
      maxDiscount: null,
      maxUsage: 100,
      usedCount: 0,
      startDate,
      endDate,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      code: 'SALE50K',
      type: 'fixed',
      value: 50000,
      scope: 'shop',
      userId: null,
      minOrderAmount: 500000,
      maxDiscount: null,
      maxUsage: 50,
      usedCount: 0,
      startDate,
      endDate,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      code: 'FREE20',
      type: 'percentage',
      value: 20,
      scope: 'shop',
      userId: null,
      minOrderAmount: 0,
      maxDiscount: 100000,
      maxUsage: 0,
      usedCount: 0,
      startDate,
      endDate,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
  ];

  let created = 0;
  for (const v of testVouchers) {
    const existing = await vouchers.findOne({ code: v.code });
    if (existing) {
      console.log(`  ⏭ ${v.code} already exists, skipping`);
      continue;
    }
    await vouchers.insertOne(v);
    console.log(`  ✅ Created ${v.code}`);
    created++;
  }

  console.log(`\n✅ Done. ${created} vouchers created, ${testVouchers.length - created} skipped.`);
  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
