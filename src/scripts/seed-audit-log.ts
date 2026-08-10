import 'dotenv/config';
import mongoose from 'mongoose';
import { AuditLog } from '../models/AuditLog.ts';
import { User } from '../models/User.ts';
import { Brand } from '../models/Brand.ts';
import { Category } from '../models/Category.ts';
import { Tag } from '../models/Tag.ts';
import { Voucher } from '../models/Voucher.ts';
import { Product } from '../models/Product.ts';
import { Order } from '../models/Order.ts';
import { Review } from '../models/Review.ts';

// ─── User Agents ────────────────────────────────────────────
const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edge/120.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  'Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  'PostmanRuntime/7.36.0',
];

// ─── IP Pool ─────────────────────────────────────────────────
const IPS = [
  '192.168.1.100', '192.168.1.101', '192.168.1.102',
  '103.21.124.10', '103.21.124.11', '103.21.124.12',
  '42.112.28.50', '42.112.28.51', '42.112.28.52',
  '171.244.10.5', '171.244.10.6',
  '14.169.45.100', '14.169.45.101',
];

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randDate(daysBack: number): Date {
  const now = Date.now();
  const offset = Math.floor(Math.random() * daysBack * 24 * 60 * 60 * 1000);
  return new Date(now - offset);
}

function formatIp(ip: string): string {
  // 30% chance replace last octet with random to simulate different machines
  if (Math.random() < 0.3) {
    const parts = ip.split('.');
    parts[3] = String(randInt(1, 254));
    return parts.join('.');
  }
  return ip;
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ MONGO_URI not set in .env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  // ── Find real data for resource references ──
  const users = await User.find({}).limit(20).lean();
  const brands = await Brand.find({}).limit(10).lean();
  const categories = await Category.find({}).limit(10).lean();
  const tags = await Tag.find({}).limit(10).lean();
  const vouchers = await Voucher.find({}).limit(10).lean();
  const products = await Product.find({}).limit(10).lean();
  const orders = await Order.find({}).limit(10).lean();
  const reviews = await Review.find({}).limit(10).lean();

  if (users.length === 0) {
    console.error('❌ No users found. Seed users first.');
    process.exit(1);
  }

  console.log(`📦 Found: ${users.length} users, ${brands.length} brands, ${categories.length} categories, ${tags.length} tags, ${vouchers.length} vouchers`);

  // ── Seed entries ──
  const entries: any[] = [];
  const now = Date.now();

  // Helper to push log
  function log(action: string, resource: string, userId: any, extra: any = {}) {
    const meta: any = {
      ip: formatIp(rand(IPS)),
      userAgent: rand(UAS),
      ...extra,
    };
    // 10% failure rate for interesting data
    const status = Math.random() < 0.1 ? 'FAILURE' : 'SUCCESS';
    entries.push({
      userId: userId._id || userId,
      action,
      resource,
      metadata: meta,
      status,
      createdAt: randDate(30),
    });
  }

  // ── REGISTER logs (50 entries) ──
  for (let i = 0; i < 50; i++) {
    const user = rand(users);
    log('REGISTER', 'User', user, { userEmail: user.email });
  }

  // ── LOGIN logs (200 entries) ──
  for (let i = 0; i < 200; i++) {
    const user = rand(users);
    log('LOGIN', 'User', user, {
      userEmail: user.email,
      rememberMe: Math.random() < 0.3,
    });
  }

  // ── LOGOUT logs (80 entries) ──
  for (let i = 0; i < 80; i++) {
    const user = rand(users);
    log('LOGOUT', 'User', user, { userEmail: user.email });
  }

  // ── PASSWORD_CHANGE logs (30 entries) ──
  for (let i = 0; i < 30; i++) {
    const user = rand(users);
    log('PASSWORD_CHANGE', 'User', user, {
      userEmail: user.email,
      details: 'Đổi mật khẩu thành công',
    });
  }

  // ── UPDATE_USER logs (40 entries) ──
  const nameParts = ['Họ tên', 'Số điện thoại', 'Địa chỉ', 'Avatar', 'Giới tính'];
  for (let i = 0; i < 40; i++) {
    const user = rand(users);
    const target = rand(users);
    log('UPDATE_USER', 'User', user, {
      resourceId: target._id,
      details: 'Cập nhật ' + rand(nameParts) + ' cho ' + (target.fullName || target.email),
    });
  }

  // ── DELETE_USER logs (15 entries) ──
  for (let i = 0; i < 15; i++) {
    const user = rand(users);
    const target = rand(users);
    log('DELETE_USER', 'User', user, {
      resourceId: target._id,
      details: 'Xoá người dùng ' + (target.fullName || target.email),
    });
  }

  // ── Brand CRUD ──
  for (let i = 0; i < 30; i++) {
    const user = rand(users);
    const brand = rand(brands);
    log('CREATE', 'Brand', user, {
      resourceId: brand._id,
      details: 'Tạo thương hiệu ' + (brand as any).name,
    });
  }
  for (let i = 0; i < 40; i++) {
    const user = rand(users);
    const brand = rand(brands);
    log('UPDATE', 'Brand', user, {
      resourceId: brand._id,
      details: 'Cập nhật thương hiệu ' + (brand as any).name + ' — thay đổi mô tả/logo',
    });
  }
  for (let i = 0; i < 10; i++) {
    const user = rand(users);
    const brand = rand(brands);
    log('DELETE', 'Brand', user, {
      resourceId: brand._id,
      details: 'Xoá thương hiệu ' + (brand as any).name,
    });
  }

  // ── Category CRUD ──
  for (let i = 0; i < 25; i++) {
    const user = rand(users);
    const cat = rand(categories);
    log('CREATE', 'Category', user, {
      resourceId: cat._id,
      details: 'Tạo danh mục ' + (cat as any).name,
    });
  }
  for (let i = 0; i < 35; i++) {
    const user = rand(users);
    const cat = rand(categories);
    log('UPDATE', 'Category', user, {
      resourceId: cat._id,
      details: 'Cập nhật danh mục ' + (cat as any).name,
    });
  }
  for (let i = 0; i < 8; i++) {
    const user = rand(users);
    const cat = rand(categories);
    log('DELETE', 'Category', user, {
      resourceId: cat._id,
      details: 'Xoá danh mục ' + (cat as any).name,
    });
  }

  // ── Tag CRUD ──
  for (let i = 0; i < 20; i++) {
    const user = rand(users);
    const tag = rand(tags);
    log('CREATE', 'Tag', user, {
      resourceId: tag._id,
      details: 'Tạo tag ' + (tag as any).name,
    });
  }
  for (let i = 0; i < 25; i++) {
    const user = rand(users);
    const tag = rand(tags);
    log('UPDATE', 'Tag', user, {
      resourceId: tag._id,
      details: 'Cập nhật tag ' + (tag as any).name,
    });
  }
  for (let i = 0; i < 6; i++) {
    const user = rand(users);
    const tag = rand(tags);
    log('DELETE', 'Tag', user, {
      resourceId: tag._id,
      details: 'Xoá tag ' + (tag as any).name,
    });
  }

  // ── Voucher CRUD ──
  for (let i = 0; i < 20; i++) {
    const user = rand(users);
    const voucher = rand(vouchers);
    log('CREATE', 'Voucher', user, {
      resourceId: voucher._id,
      details: 'Tạo mã giảm giá ' + (voucher as any).code,
    });
  }
  for (let i = 0; i < 30; i++) {
    const user = rand(users);
    const voucher = rand(vouchers);
    log('UPDATE', 'Voucher', user, {
      resourceId: voucher._id,
      details: 'Cập nhật mã giảm giá ' + (voucher as any).code + ' — thay đổi hạn mức/giá trị',
    });
  }
  for (let i = 0; i < 5; i++) {
    const user = rand(users);
    const voucher = rand(vouchers);
    log('DELETE', 'Voucher', user, {
      resourceId: voucher._id,
      details: 'Xoá mã giảm giá ' + (voucher as any).code,
    });
  }

  // ── Product CRUD (thêm cho phong phú) ──
  if (products.length > 0) {
    for (let i = 0; i < 40; i++) {
      const user = rand(users);
      const prod = rand(products);
      log('CREATE', 'Product', user, {
        resourceId: prod._id,
        details: 'Thêm sản phẩm ' + (prod as any).name,
      });
    }
    for (let i = 0; i < 50; i++) {
      const user = rand(users);
      const prod = rand(products);
      log('UPDATE', 'Product', user, {
        resourceId: prod._id,
        details: 'Cập nhật sản phẩm ' + (prod as any).name + ' — giá/tồn kho',
      });
    }
    for (let i = 0; i < 12; i++) {
      const user = rand(users);
      const prod = rand(products);
      log('DELETE', 'Product', user, {
        resourceId: prod._id,
        details: 'Xoá sản phẩm ' + (prod as any).name,
      });
    }
  }

  // ── Order CRUD (thêm cho phong phú) ──
  if (orders.length > 0) {
    for (let i = 0; i < 50; i++) {
      const user = rand(users);
      const order = rand(orders);
      log('CREATE', 'Order', user, {
        resourceId: order._id,
        details: 'Đặt hàng #' + String(order._id).slice(-6).toUpperCase(),
      });
    }
    for (let i = 0; i < 60; i++) {
      const user = rand(users);
      const order = rand(orders);
      log('UPDATE', 'Order', user, {
        resourceId: order._id,
        details: 'Cập nhật trạng thái đơn hàng #' + String(order._id).slice(-6).toUpperCase() + ' → ' + (order as any).status,
      });
    }
  }

  // ── Review CRUD ──
  if (reviews.length > 0) {
    for (let i = 0; i < 25; i++) {
      const user = rand(users);
      const review = rand(reviews);
      log('CREATE', 'Review', user, {
        resourceId: review._id,
        details: 'Viết đánh giá sản phẩm',
      });
    }
    for (let i = 0; i < 15; i++) {
      const user = rand(users);
      const review = rand(reviews);
      log('UPDATE', 'Review', user, {
        resourceId: review._id,
        details: 'Chỉnh sửa đánh giá',
      });
    }
    for (let i = 0; i < 5; i++) {
      const user = rand(users);
      const review = rand(reviews);
      log('DELETE', 'Review', user, {
        resourceId: review._id,
        details: 'Xoá đánh giá',
      });
    }
  }

  // ── Bulk insert ──
  console.log(`📝 Inserting ${entries.length} audit log entries...`);
  const batchSize = 500;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    await AuditLog.insertMany(batch);
    console.log(`  ✅ Inserted ${Math.min(i + batchSize, entries.length)} / ${entries.length}`);
  }

  console.log('🎉 Seed audit log completed!');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});