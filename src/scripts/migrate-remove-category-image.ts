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
  const coll = db.collection('categories');

  const sample = await coll.findOne({ image: { $exists: true } });
  if (!sample) {
    console.log('No categories document has the `image` field. Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  const docCount = await coll.countDocuments({ image: { $exists: true } });
  console.log(`categories — ${docCount} document(s) with image`);

  // Drop image_1 index if exists
  try {
    const indexes = await coll.indexes();
    const imageIndex = indexes.find(idx => idx.key && 'image' in idx.key);
    if (imageIndex) {
      await coll.dropIndex(imageIndex.name!);
      console.log(`  ✔ Dropped index: ${imageIndex.name}`);
    }
  } catch (err: any) {
    console.log(`  ⚠ Index drop skipped: ${err.message}`);
  }

  const result = await coll.updateMany(
    { image: { $exists: true } },
    { $unset: { image: '' } }
  );
  console.log(`  ✔ Removed image from ${result.modifiedCount} document(s)`);

  console.log('\n✅ Done.');
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
