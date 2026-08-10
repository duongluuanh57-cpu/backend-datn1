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
  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map(c => c.name);

  let totalProcessed = 0;
  let totalDocsAffected = 0;

  for (const name of collectionNames) {
    const coll = db.collection(name);

    // Check if any document still has tenantId
    const sample = await coll.findOne({ tenantId: { $exists: true } });
    if (!sample) {
      continue;
    }

    const docCount = await coll.countDocuments({ tenantId: { $exists: true } });
    console.log(`\n  📦 ${name} — ${docCount} document(s) with tenantId`);

    // Drop tenantId_1 index if exists
    try {
      const indexes = await coll.indexes();
      const tenantIndex = indexes.find(idx =>
        idx.key && 'tenantId' in idx.key
      );
      if (tenantIndex) {
        await coll.dropIndex(tenantIndex.name!);
        console.log(`     ✔ Dropped index: ${tenantIndex.name}`);
      }
    } catch (err: any) {
      console.log(`     ⚠ Index drop skipped: ${err.message}`);
    }

    // Remove tenantId field from all documents
    const result = await coll.updateMany(
      { tenantId: { $exists: true } },
      { $unset: { tenantId: '' } }
    );
    console.log(`     ✔ Removed tenantId from ${result.modifiedCount} document(s)`);

    totalProcessed++;
    totalDocsAffected += docCount;
  }

  console.log(`\n✅ Done. Processed ${totalProcessed} collection(s), ${totalDocsAffected} document(s) updated.`);
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
