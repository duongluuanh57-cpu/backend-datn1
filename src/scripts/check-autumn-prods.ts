import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
import { connectDB } from '../config/database.ts';
import { Product } from '../models/Product.ts';
import { ProductTag } from '../models/ProductTag.ts';
import { Tag } from '../models/Tag.ts';

async function check() {
  await connectDB();
  const seasons = ['xuân', 'hạ', 'thu', 'đông'];
  for (const s of seasons) {
    const prods = await Product.find({
      status: 'active',
      $or: [
        { season: { $regex: new RegExp(s, 'i') } },
        { 'specifications.season': { $regex: new RegExp(s, 'i') } },
      ]
    }).sort({ soldCount: -1, createdAt: -1 }).lean();

    const tagLinks = await ProductTag.find({ productId: { $in: prods.map(p => p._id) } })
      .populate({ path: 'tagId', model: Tag })
      .lean();
    
    const tagMap = new Map();
    for (const l of tagLinks) {
      const pId = l.productId.toString();
      if (!tagMap.has(pId)) tagMap.set(pId, []);
      tagMap.get(pId).push((l.tagId as any)?.name || (l.tagId as any)?.slug);
    }

    console.log(`\n=== MÙA ${s.toUpperCase()} (Total: ${prods.length}) ===`);
    for (let i = 0; i < Math.min(5, prods.length); i++) {
      const p = prods[i];
      const tags = tagMap.get(p._id.toString()) || [];
      console.log(`  ${i + 1}. ${p.name} | soldCount: ${p.soldCount} | tags: [${tags.join(', ')}] | discount: ${p.discountPercentage}`);
    }
  }

  await mongoose.disconnect();
}
check();
