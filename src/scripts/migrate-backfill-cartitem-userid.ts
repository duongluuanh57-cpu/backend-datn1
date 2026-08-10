import 'dotenv/config';
import mongoose from 'mongoose';

async function migrate() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGO_URI is not defined');

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
  });
  console.log(`Connected: ${mongoose.connection.host}\n`);

  const db = mongoose.connection.db!;
  const cartItems = db.collection('cartitems');
  const carts = db.collection('carts');

  const missing = await cartItems.find({ userId: { $exists: false } }).toArray();
  if (missing.length === 0) {
    console.log('✅ All cart items already have userId. Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${missing.length} cart items missing userId.\n`);

  let updated = 0;
  let failed = 0;

  for (const item of missing) {
    if (!item.cartId) {
      console.warn(`  ⚠ Skipping item ${item._id} — no cartId`);
      failed++;
      continue;
    }
    const cart = await carts.findOne({ _id: item.cartId });
    if (!cart || !cart.userId) {
      console.warn(`  ⚠ Skipping item ${item._id} — cart ${item.cartId} not found or has no userId`);
      failed++;
      continue;
    }
    await cartItems.updateOne(
      { _id: item._id },
      { $set: { userId: cart.userId } }
    );
    updated++;
    if (updated % 100 === 0) console.log(`  ... ${updated} updated`);
  }

  console.log(`\n✅ Done. ${updated} updated, ${failed} failed.`);
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
