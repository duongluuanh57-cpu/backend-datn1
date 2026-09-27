/**
 * Seed lượt bán cho section "Top sản phẩm bán chạy toàn sàn" ở trang chủ.
 *
 * Chạy:
 *   npx tsx scripts/seed-best-sellers.ts            # đặt soldCount cho 16 chai đạt luật Bán chạy
 *   npx tsx scripts/seed-best-sellers.ts --purge    # trả lại đúng soldCount như trước khi seed
 *
 * Section này KHÔNG phải "top 16 theo soldCount". Nó đọc ProductService.getTrendingProducts(16),
 * hàm chỉ trả về chai đã đạt TAG_RULES Bán chạy (src/services/product/tagRules.ts:47):
 * soldCount >= 15 + rating trung bình review visible >= 4.5 + còn hàng, rồi trừ sản phẩm
 * đang flash sale. Không chai nào đạt thì candidateIds rỗng -> trả [] ->
 * frontend HotProductSession return null (ẩn cả section, src/components/home/hot-product-session.tsx:96).
 *
 * Seed đơn (seed-orders.ts:474) cộng soldCount rải trên 93 chai nên không chai tới 15.
 * Vì thế script chọn 16 chai đã thoả sẵn cổng rating + tồn kho (chỉ thiếu soldCount) rồi đặt
 * soldCount theo bậc giảm dần >= hotMinSold. Không bịa review, không đổi giá, không đổi tồn kho.
 *
 * Chạy lại nhiều lần cho cùng kết quả: thứ tự chọn là soldCount giảm dần rồi _id tăng dần,
 * và giá trị ghi vào là max(bậc, soldCount đang có) nên không bao giờ hạ số bán thật.
 * Baseline lưu soldCount gốc trong .backups/seed-best-sellers-baseline.json cho --purge.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/database.ts';
import { Product } from '../src/models/Product.ts';
import { ProductVariant } from '../src/models/ProductVariant.ts';
import { Review } from '../src/models/Review.ts';
import { TAG_RULES } from '../src/services/product/tagRules.ts';
import { DiscountLifecycleService } from '../src/services/product/discountLifecycleService.ts';
import { ProductService } from '../src/services/ProductService.ts';

const COUNT = 16;
const BASELINE_FILE = path.resolve(process.cwd(), '.backups', 'seed-best-sellers-baseline.json');

/** Bậc soldCount giảm dần để bảng xếp hạng trông tự nhiên; giá trị cuối vẫn >= hotMinSold. */
const LADDER = [48, 44, 41, 38, 35, 32, 30, 28, 26, 24, 22, 21, 20, 19, 17, 15];

type Baseline = Record<string, number>;

function readBaseline(): Baseline {
  if (!fs.existsSync(BASELINE_FILE)) return {};
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) as Baseline;
}

function writeBaseline(b: Baseline) {
  fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(b, null, 2), 'utf8');
}

/**
 * Chai active, còn hàng và có review visible trung bình >= hotMinRating — tức đã đạt mọi cổng
 * của luật Bán chạy trừ soldCount. Cùng định nghĩa rating mà card đang hiển thị
 * (productFormatterService.ts:87 group review visible).
 */
async function findCandidates() {
  const inStockIds = await ProductVariant.distinct('productId', { quantityInStock: { $gt: 0 } });
  const rated = await Review.aggregate<{ _id: mongoose.Types.ObjectId; avg: number }>([
    { $match: { status: 'visible' } },
    { $group: { _id: '$productId', avg: { $avg: '$rating' } } },
    { $match: { avg: { $gte: TAG_RULES.hotMinRating } } },
  ]);
  const avgById = new Map(rated.map((r) => [String(r._id), r.avg]));

  const products = await Product.find({ status: 'active', _id: { $in: inStockIds } })
    .select('name brandId soldCount')
    .lean();

  return products
    .filter((p: any) => avgById.has(String(p._id)))
    .map((p: any) => ({ ...p, avgRating: avgById.get(String(p._id)) as number }))
    .sort((a: any, b: any) =>
      (b.soldCount || 0) - (a.soldCount || 0) ||
      b.avgRating - a.avgRating ||
      String(a._id).localeCompare(String(b._id)),
    )
    .slice(0, COUNT);
}

async function clearCaches() {
  const cleared = await DiscountLifecycleService.clearDiscountCaches();
  console.log(`Đã xoá ${cleared} key cache redis (products:trending:*, homepage:*, graphql:*).`);
}

async function purge() {
  const baseline = readBaseline();
  const ids = Object.keys(baseline);
  if (ids.length === 0) {
    console.log(`Không có baseline ở ${BASELINE_FILE} — không có gì để trả lại.`);
    await mongoose.disconnect();
    process.exit(0);
  }
  await Product.bulkWrite(ids.map((id) => ({
    updateOne: { filter: { _id: new mongoose.Types.ObjectId(id) }, update: { $set: { soldCount: baseline[id] } } },
  })) as any);
  await clearCaches();
  fs.rmSync(BASELINE_FILE);
  const list = await ProductService.getTrendingProducts(COUNT);
  console.log(`\n✅ Đã trả lại soldCount gốc cho ${ids.length} chai. Section hot bây giờ: ${list.length} chai.`);
  await mongoose.disconnect();
  process.exit(0);
}

async function main() {
  if (process.argv.includes('--purge')) {
    await connectDB();
    await purge();
  }

  await connectDB();
  const candidates = await findCandidates();
  console.log(`Chai đạt cổng rating (>= ${TAG_RULES.hotMinRating}) + còn hàng: ${candidates.length}/${COUNT} được chọn`);
  if (candidates.length === 0) {
    console.log('Không có chai nào đạt cả hai cổng — section hot không thể hiện mà không bịa review. Dừng.');
    await mongoose.disconnect();
    process.exit(1);
  }
  if (candidates.length < COUNT) {
    console.log(`⚠️  Chỉ ${candidates.length} chai đạt, ít hơn 16. Section sẽ hiển thị đúng số này.`);
  }

  const baseline = readBaseline();
  const ops: any[] = [];
  const rows: string[] = [];
  candidates.forEach((p: any, i: number) => {
    const key = String(p._id);
    if (!(key in baseline)) baseline[key] = p.soldCount || 0;
    const target = Math.max(LADDER[i] ?? TAG_RULES.hotMinSold, TAG_RULES.hotMinSold, p.soldCount || 0);
    if (target !== (p.soldCount || 0)) {
      ops.push({ updateOne: { filter: { _id: new mongoose.Types.ObjectId(key) }, update: { $set: { soldCount: target } } } });
    }
    rows.push(`  ${String(i + 1).padStart(2)}. ${String(target).padStart(3)} bán | rating ${p.avgRating.toFixed(2)} | ${String(p.name).slice(0, 48)}`);
  });

  if (ops.length) await Product.bulkWrite(ops as any);
  writeBaseline(baseline);
  await clearCaches();

  // Chạy đúng đường dẫn thật mà homepage dùng, kể cả bước trừ sản phẩm flash sale.
  const hot = await ProductService.getTrendingProducts(COUNT);
  console.log(`\nSoldCount cũ -> mới:`);
  console.log(rows.join('\n'));
  console.log(`\ngetTrendingProducts(${COUNT}) trả về: ${hot.length} chai`);
  if (hot.length === 0) {
    console.log('❌ Vẫn rỗng — kiểm tra flash sale đang giữ hết candidate hoặc cache chưa xoá.');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`✅ Baseline gốc: ${BASELINE_FILE}`);
  console.log('   (BE giữ homepage cache trong RAM tiến trình nên cần restart backend để SSR trang chủ dựng lại.)');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
