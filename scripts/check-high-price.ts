/**
 * Thống kê sản phẩm giá cao trên DB.
 * Giá hiển thị = giá variant dung tích lớn nhất còn hàng, đã trừ discountPercentage
 * (đúng cách formatMultipleProducts tính giá), vì Product không có field price gốc.
 *
 * Chạy: npx tsx scripts/check-high-price.ts [--active-only]
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { Product } from '../src/models/Product.ts';
import { ProductVariant } from '../src/models/ProductVariant.ts';
import { parseCapacity } from '../src/services/product/productHelpers.ts';

const activeOnly = process.argv.includes('--active-only');

type Row = {
  id: string;
  name: string;
  status: string;
  displayPrice: number;
  minPrice: number;
  discount: number;
  totalStock: number;
  variantCount: number;
};

async function main() {
  await mongoose.connect(process.env.MONGO_URI!, { serverSelectionTimeoutMS: 30000 });

  const productFilter = activeOnly ? { status: 'active' } : {};
  const products = await Product.find(productFilter)
    .select('name status discountPercentage')
    .lean();

  const variants = await ProductVariant.find({
    productId: { $in: products.map((p: any) => p._id) },
  })
    .select('productId size price quantityInStock')
    .lean();

  const byProduct = new Map<string, any[]>();
  for (const v of variants) {
    const key = String(v.productId);
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key)!.push(v);
  }

  const rows: Row[] = [];
  let noVariant = 0;

  for (const p of products as any[]) {
    const vs = byProduct.get(String(p._id)) || [];
    if (vs.length === 0) {
      noVariant++;
      rows.push({
        id: String(p._id), name: p.name, status: p.status, displayPrice: 0,
        minPrice: 0, discount: p.discountPercentage || 0, totalStock: 0, variantCount: 0,
      });
      continue;
    }
    const sorted = [...vs].sort((a, b) => parseCapacity(b.size) - parseCapacity(a.size));
    const defaultVariant = sorted.find((v) => v.quantityInStock > 0) || sorted[0];
    const discount = p.discountPercentage || 0;
    rows.push({
      id: String(p._id),
      name: p.name,
      status: p.status,
      displayPrice: Math.round(defaultVariant.price * (1 - discount / 100)),
      minPrice: Math.round(Math.min(...vs.map((v) => v.price ?? 0))),
      discount,
      totalStock: vs.reduce((s, v) => s + (v.quantityInStock || 0), 0),
      variantCount: vs.length,
    });
  }

  const byDisplay = [...rows].sort((a, b) => b.displayPrice - a.displayPrice);
  const money = (n: number) => n.toLocaleString('vi-VN');

  console.log(`Tổng sản phẩm quét: ${rows.length} (active-only=${activeOnly}) | không có variant: ${noVariant}`);

  const byStatus = new Map<string, { total: number; withVariant: number; noVariant: number }>();
  for (const r of rows) {
    const s = byStatus.get(r.status) || { total: 0, withVariant: 0, noVariant: 0 };
    s.total++;
    if (r.variantCount === 0) s.noVariant++; else s.withVariant++;
    byStatus.set(r.status, s);
  }
  console.log('\n=== Phân tách theo status (giải thích vì sao khác con số 92) ===');
  for (const [status, s] of byStatus) {
    console.log(`  ${status.padEnd(10)}: total ${s.total} | có variant ${s.withVariant} | KHÔNG có variant ${s.noVariant}`);
  }

  console.log('\n=== Đếm theo GIÁ HIỂN THỊ (variant lớn nhất còn hàng, đã trừ giảm giá) ===');
  for (const th of [500_000, 1_000_000, 2_000_000, 3_000_000, 5_000_000, 10_000_000]) {
    console.log(`  >= ${money(th)}đ : ${rows.filter((r) => r.displayPrice >= th).length}`);
  }
  console.log('\n=== Đếm theo GIÁ THẤP NHẤT trong các variant ===');
  for (const th of [1_000_000, 3_000_000, 5_000_000]) {
    console.log(`  >= ${money(th)}đ : ${rows.filter((r) => r.minPrice >= th).length}`);
  }

  const inRange = (lo: number, hi: number) =>
    rows.filter((r) => r.displayPrice >= lo && r.displayPrice < hi).length;
  console.log('\n=== Phân bố giá hiển thị ===');
  console.log(`  < 1tr        : ${inRange(0, 1_000_000)}`);
  console.log(`  1tr - 2tr    : ${inRange(1_000_000, 2_000_000)}`);
  console.log(`  2tr - 3tr    : ${inRange(2_000_000, 3_000_000)}`);
  console.log(`  3tr - 5tr    : ${inRange(3_000_000, 5_000_000)}`);
  console.log(`  >= 5tr       : ${inRange(5_000_000, Number.MAX_SAFE_INTEGER)}`);

  console.log('\n=== TOP 16 giá cao nhất (đây là đống mà luật cũ gán tag Limited bừa) ===');
  byDisplay.slice(0, 16).forEach((r, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)}. ${money(r.displayPrice).padStart(13)}đ | tồn ${String(r.totalStock).padStart(5)} | ${r.status} | disc ${r.discount}% | ${r.name.slice(0, 58)}`,
    );
  });

  const highAndScarce = byDisplay.filter((r) => r.displayPrice >= 3_000_000 && r.totalStock > 0 && r.totalStock <= 20);
  console.log(`\nGiá >= 3tr VÀ tổng tồn 1..20 (vừa sang vừa khan hiếm thật): ${highAndScarce.length}`);
  highAndScarce.slice(0, 10).forEach((r) => console.log(`  - ${money(r.displayPrice)}đ | tồn ${r.totalStock} | ${r.name.slice(0, 58)}`));
}

main().finally(() => process.exit(0));
