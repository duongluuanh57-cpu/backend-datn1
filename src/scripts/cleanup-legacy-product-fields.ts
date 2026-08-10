import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
import { connectDB } from '../config/database.ts';

async function cleanupLegacyProductFields() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await connectDB();

    const db = mongoose.connection.db;
    if (!db) {
      console.error('❌ DB connection not established');
      process.exit(1);
    }

    const productsCollection = db.collection('products');

    console.log('🧹 Cleaning up legacy fields from products collection...');

    const result = await productsCollection.updateMany(
      {},
      {
        $unset: {
          scentGroups: '',
          concentrations: '',
          segments: '',
          price: '',
          quantityInStock: '',
        },
      }
    );

    console.log(`✅ Cleanup completed successfully! Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  }
}

cleanupLegacyProductFields();
