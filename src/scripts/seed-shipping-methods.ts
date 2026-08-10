/**
 * Seed dữ liệu mặc định cho ShippingMethod.
 * Chạy: npx tsx src/scripts/seed-shipping-methods.ts
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import { ShippingMethod } from '../models/ShippingMethod.ts';

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || '';

const defaultMethods = [
  {
    name: 'Giao hàng tiêu chuẩn',
    code: 'standard',
    fee: 30000,
    freeShipMinAmount: 500000,
    estimatedDays: '3-5 ngày',
    isActive: true,
    sortOrder: 0,
  },
  {
    name: 'Giao hàng hỏa tốc',
    code: 'express',
    fee: 50000,
    freeShipMinAmount: 0,
    estimatedDays: '1-2 ngày',
    isActive: true,
    sortOrder: 1,
  },
];

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  for (const method of defaultMethods) {
    const existing = await ShippingMethod.findOne({ code: method.code });
    if (existing) {
      console.log(`✓ Đã tồn tại: ${method.code} — bỏ qua`);
    } else {
      await ShippingMethod.create(method);
      console.log(`✅ Tạo mới: ${method.name} (${method.code}) — phí ${method.fee.toLocaleString('vi-VN')}đ`);
    }
  }

  console.log('\n🎉 Seed ShippingMethod hoàn tất!');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('❌ Lỗi seed:', err);
  process.exit(1);
});
