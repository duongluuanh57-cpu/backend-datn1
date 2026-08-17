import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { connectDB } from '../config/database.ts';
import { OrderItem } from '../models/OrderItem.ts';
import { Product } from '../models/Product.ts';
import { Brand } from '../models/Brand.ts';

async function main() {
  console.log('🖼️ Bắt đầu cập nhật ảnh cho Product và OrderItem...');

  await connectDB();

  // 1. Backfill ảnh cho Product chưa có ảnh từ Brand Logo
  const productsWithoutImage = await Product.find({
    $or: [{ image: { $exists: false } }, { image: null }, { image: '' }],
  })
    .populate('brandId', 'logo')
    .lean();

  console.log(`📦 Tìm thấy ${productsWithoutImage.length} Products chưa có ảnh.`);

  const prodOps = [];
  for (const p of productsWithoutImage) {
    const brandLogo = (p.brandId as any)?.logo;
    if (brandLogo) {
      prodOps.push({
        updateOne: {
          filter: { _id: p._id },
          update: { $set: { image: brandLogo } },
        },
      });
    }
  }

  if (prodOps.length > 0) {
    const prodRes = await Product.bulkWrite(prodOps);
    console.log(`✅ Đã cập nhật ảnh cho ${prodRes.modifiedCount} Products từ Brand Logo!`);
  }

  // 2. Backfill ảnh cho OrderItem
  const emptyItems = await OrderItem.find({
    $or: [{ image: { $exists: false } }, { image: null }, { image: '' }],
  }).lean();

  console.log(`📦 Tìm thấy ${emptyItems.length} OrderItems chưa có ảnh.`);

  const productIds = [
    ...new Set(emptyItems.map((i) => i.productId?.toString()).filter(Boolean)),
  ].map((id) => new mongoose.Types.ObjectId(id as string));

  const allProducts = await Product.find({ _id: { $in: productIds } })
    .select('_id image brandId')
    .populate('brandId', 'logo')
    .lean();

  const prodImageMap = new Map<string, string>();
  for (const p of allProducts) {
    const img = p.image || (p.brandId as any)?.logo || '';
    if (img) {
      prodImageMap.set(p._id.toString(), img);
    }
  }

  const itemOps = [];
  for (const it of emptyItems) {
    const pid = it.productId?.toString();
    const resolvedImg = (pid && prodImageMap.get(pid)) || '';
    if (resolvedImg) {
      itemOps.push({
        updateOne: {
          filter: { _id: it._id },
          update: { $set: { image: resolvedImg } },
        },
      });
    }
  }

  if (itemOps.length > 0) {
    const itemRes = await OrderItem.bulkWrite(itemOps);
    console.log(`✅ Đã cập nhật ảnh cho ${itemRes.modifiedCount} OrderItems!`);
  }

  await mongoose.disconnect();
  console.log('🍃 Hoàn tất và ngắt kết nối database.');
  process.exit(0);
}

main().catch(async (e) => {
  console.error('❌ Lỗi:', e);
  await mongoose.disconnect();
  process.exit(1);
});
