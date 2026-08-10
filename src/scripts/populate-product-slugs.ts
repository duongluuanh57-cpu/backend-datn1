import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';
import { slugify } from '../utils/textNormalizer.ts';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
import { connectDB } from '../config/database.ts';

async function populateProductSlugs() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await connectDB();

    const db = mongoose.connection.db;
    if (!db) {
      console.error('❌ DB connection not established');
      process.exit(1);
    }

    const productsCollection = db.collection('products');
    const products = await productsCollection.find({}).toArray();

    console.log(`📦 Found ${products.length} products to check/generate slugs...`);

    const existingSlugs = new Set<string>();
    let updatedCount = 0;

    for (const p of products) {
      let baseSlug = p.slug;
      if (!baseSlug) {
        baseSlug = slugify(p.name || 'product');
      }

      let uniqueSlug = baseSlug;
      let counter = 1;

      while (existingSlugs.has(uniqueSlug)) {
        uniqueSlug = `${baseSlug}-${counter}`;
        counter++;
      }

      existingSlugs.add(uniqueSlug);

      if (p.slug !== uniqueSlug) {
        await productsCollection.updateOne(
          { _id: p._id },
          { $set: { slug: uniqueSlug } }
        );
        updatedCount++;
      }
    }

    console.log(`✅ Successfully generated & updated slugs for ${updatedCount} products!`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

populateProductSlugs();
