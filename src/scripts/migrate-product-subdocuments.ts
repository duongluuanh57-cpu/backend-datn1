import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';

// Load .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { connectDB } from '../config/database.ts';

async function migrateProducts() {
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
    console.log(`📦 Found ${products.length} products to migrate...`);

    let migratedCount = 0;

    for (const doc of products) {
      const specifications: Record<string, any> = doc.specifications || {};
      const aiData: Record<string, any> = doc.aiData || {};

      // Migrate perfume spec fields if present at root level
      if (doc.longevity !== undefined) specifications.longevity = doc.longevity;
      if (doc.sillage !== undefined) specifications.sillage = doc.sillage;
      if (doc.scentTrail !== undefined) specifications.scentTrail = doc.scentTrail;
      if (doc.style !== undefined) specifications.style = doc.style;
      if (doc.suitableFor !== undefined) specifications.suitableFor = doc.suitableFor;
      if (doc.occasion !== undefined) specifications.occasion = doc.occasion;
      if (doc.season !== undefined) specifications.season = doc.season;
      if (doc.time !== undefined) specifications.time = doc.time;

      // Migrate AI fields if present at root level
      if (doc.embedding !== undefined) aiData.embedding = doc.embedding;
      if (doc.isSupplemented !== undefined) aiData.isSupplemented = doc.isSupplemented;

      const updateOp: Record<string, any> = {
        $set: {
          specifications,
          aiData,
        },
        $unset: {
          longevity: '',
          sillage: '',
          scentTrail: '',
          style: '',
          suitableFor: '',
          occasion: '',
          season: '',
          time: '',
          durability: '',
          discountStartDate: '',
          discountEndDate: '',
          embedding: '',
          isSupplemented: '',
        },
      };

      await productsCollection.updateOne({ _id: doc._id }, updateOp);
      migratedCount++;
    }

    console.log(`✅ Successfully migrated ${migratedCount} products to the new sub-document structure!`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrateProducts();
