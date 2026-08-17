import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { connectDB } from '../config/database.ts';
import { Product } from '../models/Product.ts';
import { ProductVariant } from '../models/ProductVariant.ts';

async function main() {
  await connectDB();

  const prods = await Product.find({ name: /YSL/i }).limit(3).lean();
  console.log('Products matching YSL:', JSON.stringify(prods, null, 2));

  const sampleProdsWithImages = await Product.find({
    $or: [
      { image: { $exists: true, $ne: '' } },
      { images: { $exists: true, $ne: [] } },
    ],
  }).limit(3).lean();
  console.log('Sample Products with images:', JSON.stringify(sampleProdsWithImages, null, 2));

  const sampleVariants = await ProductVariant.find().limit(3).lean();
  console.log('Sample ProductVariants:', JSON.stringify(sampleVariants, null, 2));

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
