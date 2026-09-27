/**
 * Hạ tồn kho của các sản phẩm active có giá hiển thị >= ngưỡng (mặc định 5 triệu)
 * xuống tổng 1..20 chai, để chúng đạt luật Limited trong src/services/product/tagRules.ts
 * (limitedMaxTotalStock = 20) và hiện trong section "Sản phẩm giới hạn".
 *
 * Mặc định DRY-RUN. Thêm --yes để ghi thật. Giá trị cũ dump ra .backups/ để phục hồi.
 *
 * Chạy: npx tsx scripts/seed-limited-stock.ts [--yes] [--min-price=5000000]
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { Product } from '../src/models/Product.ts';
import { ProductVariant } from '../src/models/ProductVariant.ts';
import { parseCapacity } from '../src/services/product/productHelpers.ts';

const WRITE = process.argv.includes('--yes');
const minPriceArg = process.argv.find((a) => a.startsWith('--min-price='));
const MIN_PRICE = minPriceArg ? Number(minPriceArg.split('=')[1]) : 5_000_000;
const LIMITED_MAX = 20;

async function main() {
  await mongoose.connect(process.env.MONGO_URI!, { serverSelectionTimeoutMS: 30000 });

  const products = await Product.find({ status: 'active' }).select('name discountPercentage').lean();
  const variants = await ProductVariant.find({
    productId: { $in: products.map((p: any) => p._id) },
  }).select('productId size price quantityInStock').lean();

  const byProduct = new Map<string, any[]>();
  for (const v of variants) {
    const key = String(v.productId);
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key)!.push(v);
  }

  const priceOf = (vs: any[]) => {
    const sorted = [...vs].sort((a, b) => parseCapacity(b.size) - parseCapacity(a.size));
    const pick = sorted.find((v) => v.quantityInStock > 0) || sorted[0];
    return pick ? pick.price : 0;
  };

  const targets: { product: any; vs: any[]; price: number }[] = [];
  for (const p of products as any[]) {
    const vs = byProduct.get(String(p._id)) || [];
    if (vs.length === 0) continue;
    const discount = p.discountPercentage || 0;
    const display = Math.round(priceOf(vs) * (1 - discount / 100));
    if (display >= MIN_PRICE) targets.push({ product: p, vs, price: display });
  }
  targets.sort((a, b) => b.price - a.price);

  console.log(`Sản phẩm active có giá hiển thị >= ${MIN_PRICE.toLocaleString('vi-VN')}đ: ${targets.length}`);

  const backup: any[] = [];
  const plan: { id: any; name: string; total: number; detail: { size: string; from: number; to: number }[] }[] = [];

  targets.forEach((t, i) => {
    const sorted = [...t.vs].sort((a, b) => parseCapacity(b.size) - parseCapacity(a.size));
    const n = sorted.length;
    let total = Math.min(LIMITED_MAX - 2, Math.max(n + 2, 6 + i * 2));
    if (total > LIMITED_MAX) total = LIMITED_MAX;
    let left = total;
    const detail = sorted.map((v, idx) => {
      const reservedForOthers = n - 1 - idx;
      const to = idx === 0 ? Math.max(1, left - reservedForOthers) : 1;
      left -= to;
      return { size: v.size, from: v.quantityInStock, to };
    });
    const sum = detail.reduce((s, d) => s + d.to, 0);
    plan.push({ id: t.product._id, name: t.product.name, total: sum, detail });
    backup.push({ productId: t.product._id, variants: sorted.map((v) => ({ _id: v._id, size: v.size, price: v.price, quantityInStock: v.quantityInStock })) });
  });

  plan.forEach((p) => {
    console.log(`\n${p.name}  ->  tổng ${p.total}`);
    p.detail.forEach((d) => console.log(`   ${String(d.size).padEnd(8)} ${d.from} -> ${d.to}`));
  });

  const dir = path.resolve(process.cwd(), '.backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `limited-stock-old-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`\nBackup tồn kho cũ: ${file}`);

  if (!WRITE) {
    console.log('DRY-RUN: chưa ghi gì. Chạy lại với --yes để áp dụng.');
    return;
  }

  for (const p of plan) {
    for (const d of p.detail) {
      await ProductVariant.updateOne({ productId: p.id, size: d.size }, { $set: { quantityInStock: d.to } });
    }
  }
  console.log(`ĐÃ GHI tồn kho mới cho ${plan.length} sản phẩm.`);
}

main().finally(() => process.exit(0));
