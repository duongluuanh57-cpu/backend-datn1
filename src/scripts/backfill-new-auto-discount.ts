import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { connectDB } from '../config/database.ts';
import { DiscountLifecycleService } from '../services/product/discountLifecycleService.ts';

/**
 * Backfill 1 lần: gán discount 5% hệ thống cho hàng Tag New chưa có giảm giá.
 * Dùng chung lõi DiscountLifecycleService (mô hình trung tâm).
 * CHỈ hàng Tag New — loại trừ Flash Sale + Limited, không đụng giảm giá sẵn có.
 *
 * Cách chạy:
 *   npx tsx src/scripts/backfill-new-auto-discount.ts            (dry-run, không ghi)
 *   npx tsx src/scripts/backfill-new-auto-discount.ts --apply    (ghi thật + xóa cache)
 * Hoặc: npm run discount:backfill-new [-- --apply]
 */

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`🚀 [Backfill New 5%] Chế độ: ${APPLY ? 'APPLY (ghi thật)' : 'DRY-RUN (chỉ xem, không ghi)'}`);
  await connectDB();

  if (!APPLY) {
    const preview = await DiscountLifecycleService.preview();
    console.log(`🎯 Đủ điều kiện gán 5% (New + chưa giảm giá + không Flash/Limited): ${preview.assigned}`);
    console.log(`   Bỏ qua (đã có giảm giá thật): ${preview.skippedHasDiscount}`);
    console.log(`   Bỏ qua (Flash Sale/Limited/Sale): ${preview.skippedFlashSaleOrLimited}`);
    console.log(`   Sẽ thu hồi (hết New): ${preview.reclaimed}`);
    console.log(`📊 Hàng Standard sẽ gán theo công thức (tồn+tuổi+sức bán, trần 15%): ${preview.standardAssigned}`);
    console.log(`   Chi tiết mức: ${JSON.stringify(preview.standardLevels)}`);
    console.log(`   Bỏ qua (hết hàng-giữ nguyên): ${preview.skippedStandardOOS}`);
    console.log(`   Bỏ qua (khuyến mãi khác): ${preview.skippedStandardPromo}`);
    console.log(`   Bỏ qua (New/Flash/Limited): ${preview.skippedStandardExcluded}`);
    console.log(`💎 Hàng Limited sẽ gán theo khan hiếm (trần 5%): ${preview.limitedAssigned}`);
    console.log(`   Chi tiết mức: ${JSON.stringify(preview.limitedLevels)}`);
    console.log(`   Bỏ qua (hết hàng-giữ nguyên): ${preview.skippedLimitedOOS}`);
    console.log(`   Bỏ qua (khuyến mãi khác): ${preview.skippedLimitedPromo}`);
    console.log(`   Bỏ qua (New/Flash): ${preview.skippedLimitedExcluded}`);
    if (preview.sampleLimited.length > 0) {
      console.log('   Mẫu 10 sản phẩm Limited sẽ gán:');
      for (const s of preview.sampleLimited) console.log(`   - ${s}`);
    }
    if (preview.sampleAssign.length > 0) {
      console.log('   Mẫu 10 sản phẩm sẽ gán:');
      for (const s of preview.sampleAssign) console.log(`   - ${s}`);
    }
    if (preview.sampleReclaim.length > 0) {
      console.log('   Mẫu 10 sản phẩm sẽ thu hồi:');
      for (const s of preview.sampleReclaim) console.log(`   - ${s}`);
    }
    console.log('✅ Dry-run xong, chưa ghi gì. Chạy lại với --apply để ghi thật.');
    await mongoose.disconnect();
    return;
  }

  const result = await DiscountLifecycleService.runCycle(false);
  console.log(`✅ Đã gán 5% cho ${result.assigned} sản phẩm New.`);
  console.log(`♻️ Đã thu hồi ${result.reclaimed} sản phẩm hết New (gỡ cờ giữ số: ${result.reclaimedFlagOnly}).`);
  console.log(`📊 Đã gán discount Standard cho ${result.standardAssigned} sản phẩm (mức: ${JSON.stringify(result.standardLevels)}).`);
  console.log(`💎 Đã gán discount Limited cho ${result.limitedAssigned} sản phẩm (mức: ${JSON.stringify(result.limitedLevels)}).`);
  console.log('🗑️ Cache section liên quan đã được xóa kèm theo.');
  console.log('ℹ️ Cache chi tiết sản phẩm tự hết hạn sau ~5 phút; cache memory trang chủ tự refresh sau ~3 phút.');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('❌ Lỗi:', err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
