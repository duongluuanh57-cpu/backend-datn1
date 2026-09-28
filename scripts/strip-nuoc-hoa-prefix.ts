/**
 * Bỏ tiền tố "Nước hoa " (hoặc "nuoc hoa ", mọi hoa/thường) khỏi TÊN sản phẩm,
 * giữ nguyên phần tên phía sau. KHÔNG đụng slug — slug đã có sẵn tiền tố
 * `nuoc-hoa-...` và là identity SEO/URL đang chạy, đổi sẽ gãy link.
 *
 * Chạy:
 *   npx tsx scripts/strip-nuoc-hoa-prefix.ts           # dry-run, chỉ báo cáo
 *   npx tsx scripts/strip-nuoc-hoa-prefix.ts --apply   # ghi DB + xóa cache
 *
 * Sau khi ghi: xóa cache Redis trang chủ/products (FlashSaleService.clearCache
 * quét prefix homepage:* + products:*) để trang chủ/admin hiện tên mới ngay.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/database.ts';
import { redis } from '../src/config/redis.ts';
import { Product } from '../src/models/Product.ts';
import { FlashSaleService } from '../src/services/FlashSaleService.ts';

/** Bỏ "Nước hoa " / "nuoc hoa " đầu tên, giữ nguyên mọi thứ đằng sau. */
const PREFIX = /^(nước\s+hoa|nuoc\s+hoa)\s+/i;

function stripPrefix(name: string): string {
  return name.replace(PREFIX, '').trim();
}

async function main() {
  const apply = process.argv.includes('--apply');

  await connectDB();
  if (mongoose.connection.readyState !== 1) {
    throw new Error('Không kết nối được MongoDB — dừng, không ghi gì.');
  }

  const rows = await Product.find({ name: PREFIX }).select('name slug').lean();
  console.log(`\nTìm thấy ${rows.length} sản phẩm có tên bắt đầu "Nước hoa ..."\n`);
  for (const row of rows) {
    const next = stripPrefix(row.name);
    // Guard: không bao giờ ra tên rỗng (vd tên chỉ gồm tiền tố).
    const safe = next.length > 0 ? next : row.name;
    console.log(`  ${row.name}\n    → ${safe}   (slug giữ nguyên: ${row.slug})`);
  }

  if (!apply) {
    console.log(`\n[DRY-RUN] Chưa ghi gì. Chạy lại với --apply để cập nhật ${rows.length} bản ghi.\n`);
    return;
  }

  let updated = 0;
  for (const row of rows) {
    const next = stripPrefix(row.name);
    if (next.length === 0 || next === row.name) continue;
    await Product.updateOne({ _id: row._id }, { $set: { name: next } });
    updated++;
  }

  // Verify: không còn tên nào khớp tiền tố.
  const remain = await Product.countDocuments({ name: PREFIX });
  console.log(`\n✅ Đã cập nhật ${updated} tên. Kiểm tra lại: còn ${remain} tên khớp tiền tố (mong đợi 0).`);

  // Xóa cache để FE hiện tên mới (TTL cache cũ sống tới 30s+ nếu không xóa).
  try {
    await FlashSaleService.clearCache();
    console.log('✅ Đã xóa cache Redis homepage:* + products:*');
  } catch (err: any) {
    console.warn(`⚠️ Không xóa được cache Redis (${err?.message}) — cache tự hết hạn theo TTL.`);
  }

  await mongoose.disconnect();
  await redis.quit().catch(() => {});
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  await redis.quit().catch(() => {});
  process.exit(1);
});
