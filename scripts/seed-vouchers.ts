/**
 * Seed 10 mã giảm giá vào collection `vouchers`.
 *
 * Chạy:
 *   npx tsx scripts/seed-vouchers.ts               # tạo 10 mã (bỏ qua mã đã tồn tại)
 *   npx tsx scripts/seed-vouchers.ts --overwrite    # ghi đè cả mã đã tồn tại
 *   npx tsx scripts/seed-vouchers.ts --purge        # xóa đúng 10 mã do script này sinh
 *
 * Mặc định KHÔNG ghi đè: code là khóa unique và admin có thể đã tự tạo mã trùng tên,
 * nên "tồn tại rồi" = dữ liệu của họ, chỉ tay --overwrite mới được phép đè.
 *
 * Ngưỡng minOrderAmount lấy từ phân bố giá thật trong catalog
 * (npx tsx scripts/check-high-price.ts --active-only, 92 sản phẩm active):
 *   <1tr: 2 | 1-2tr: 5 | 2-3tr: 48 | 3-5tr: 30 | >=5tr: 7
 * nên đơn 2-3tr là đơn điển hình: WELCOME5/GIAM10/GIAM50K/GIAM200K/FREESHIP2TR đủ điều
 * kiện, còn GIAM15/VIP20/GIAM500K/FSEXPRESS3TR hiện đúng dòng "Chưa đủ điều kiện"
 * (VoucherSelector.tsx:272) — cả hai nhánh đều có dữ liệu demo.
 *
 * usedCount để 0: lượt dùng do CheckoutService.tryConsume ghi khi đặt hàng thật,
 * đặt số ảo vào là tự mâu thuẫn (không có đơn nào tham chiếu tới mấy mã này).
 *
 * Hai mã freeship: value=0 + type=fixed + voucherCategory='freeship' là đúng ước lệ
 * freeship của app (CartService.ts:507, voucher-list.test.tsx:14). FSEXPRESS* là mã
 * free ship Hỏa tốc — CheckoutService.ts:271 chỉ trừ tiền ship khi shippingMethod
 * === 'express', còn lại 0, nên mới gắn ngưỡng 3tr.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/database.ts';
import { Voucher } from '../src/models/Voucher.ts';
import { VoucherService } from '../src/services/VoucherService.ts';

/** Số liệu snapshot ngày 2026-09-27 — viết cứng để seed chạy lại vẫn ra đúng một bộ mã. */
const SEED = [
  { code: 'WELCOME5',      type: 'percentage', value: 5,  voucherCategory: 'discount', minOrderAmount: 0,          maxDiscount: 300_000,   maxUsage: 1000, startDate: '2026-06-01', endDate: '2026-12-31' },
  { code: 'GIAM10',        type: 'percentage', value: 10, voucherCategory: 'discount', minOrderAmount: 1_500_000,  maxDiscount: 500_000,   maxUsage: 300,  startDate: '2026-09-01', endDate: '2026-11-30' },
  { code: 'GIAM12',        type: 'percentage', value: 12, voucherCategory: 'discount', minOrderAmount: 2_000_000,  maxDiscount: 700_000,   maxUsage: 200,  startDate: '2026-09-15', endDate: '2026-10-31' },
  { code: 'GIAM15',        type: 'percentage', value: 15, voucherCategory: 'discount', minOrderAmount: 3_000_000,  maxDiscount: 900_000,   maxUsage: 100,  startDate: '2026-09-20', endDate: '2026-10-31' },
  { code: 'VIP20',         type: 'percentage', value: 20, voucherCategory: 'discount', minOrderAmount: 5_000_000,  maxDiscount: 1_500_000, maxUsage: 30,   startDate: '2026-09-01', endDate: '2026-12-31' },
  { code: 'GIAM50K',       type: 'fixed',      value: 50_000,  voucherCategory: 'discount', minOrderAmount: 500_000,    maxUsage: 500,  startDate: '2026-09-01', endDate: '2026-11-30' },
  { code: 'GIAM200K',      type: 'fixed',      value: 200_000, voucherCategory: 'discount', minOrderAmount: 2_000_000,  maxUsage: 200,  startDate: '2026-09-10', endDate: '2026-10-31' },
  { code: 'GIAM500K',      type: 'fixed',      value: 500_000, voucherCategory: 'discount', minOrderAmount: 4_000_000,  maxUsage: 80,   startDate: '2026-09-15', endDate: '2026-10-31' },
  { code: 'FREESHIP2TR',   type: 'fixed',      value: 0,       voucherCategory: 'freeship', minOrderAmount: 2_000_000,  maxUsage: 400,  startDate: '2026-09-01', endDate: '2026-12-31' },
  { code: 'FSEXPRESS3TR',  type: 'fixed',      value: 0,       voucherCategory: 'freeship', minOrderAmount: 3_000_000,  maxUsage: 100,  startDate: '2026-09-01', endDate: '2026-12-31' },
] as const;

const CODES = SEED.map(v => v.code);

const money = (n: number) => n.toLocaleString('vi-VN');

async function main() {
  await connectDB();
  // connectDB() nuốt lỗi kết nối (server vẫn boot để /health còn trả lời),
  // còn script này mà connection chưa mở là ghi vào khoảng không.
  if (mongoose.connection.readyState !== 1) {
    throw new Error('Không kết nối được MongoDB — kiểm tra MONGO_URI trong .env');
  }

  const before = await Voucher.countDocuments();

  if (process.argv.includes('--purge')) {
    const { deletedCount } = await Voucher.deleteMany({ code: { $in: CODES } });
    console.log(`🗑  Đã xóa ${deletedCount} mã seed. Vouchers: ${before} -> ${await Voucher.countDocuments()}`);
    await mongoose.disconnect();
    process.exit(0);
  }

  const overwrite = process.argv.includes('--overwrite');
  let created = 0;
  let updated = 0;
  const skipped: string[] = [];

  for (const v of SEED) {
    const filter = { code: v.code.toUpperCase() };
    const exists = await Voucher.exists(filter);
    if (exists && !overwrite) {
      skipped.push(v.code);
      continue;
    }
    const res = await Voucher.updateOne(filter, {
      $set: {
        code: v.code.toUpperCase(),
        type: v.type,
        value: v.value,
        voucherCategory: v.voucherCategory,
        minOrderAmount: v.minOrderAmount,
        ...(v.type === 'percentage' ? { maxDiscount: (v as any).maxDiscount } : {}),
        maxUsage: v.maxUsage,
        startDate: new Date(v.startDate),
        endDate: new Date(v.endDate),
        status: 'active',
      },
      // usedCount thuộc về luồng đặt hàng thật — chỉ khởi tạo khi vừa tạo doc.
      $setOnInsert: { usedCount: 0, isPublic: true },
    }, { upsert: true, setDefaultsOnInsert: true });
    if (res.upsertedCount) created++;
    else updated++;
  }

  // Kiểm chứng thật: đúng predicate mà GET /api/vouchers dùng (VoucherService.getActive).
  const active = await VoucherService.getActive();
  const activeCodes = new Set(active.map((v: any) => v.code));
  const surfaced = CODES.filter(c => activeCodes.has(c));

  // Một giỏ 2.5tr là giỏ điển hình của shop — đếm xem bao nhiêu mã đủ điều kiện hiện lên.
  const DEMO_CART = 2_500_000;
  const eligible = await VoucherService.getActive();
  const eligibleForCart = eligible.filter((v: any) => CODES.includes(v.code) && DEMO_CART >= (v.minOrderAmount || 0));

  console.log(`\n🎟  10 mã giảm giá — mẫu:`);
  for (const v of SEED.slice(0, 5)) {
    console.log(`   ${v.code.padEnd(14)} ${String(v.type === 'percentage' ? `${v.value}%` : `${money(v.value)}đ`).padStart(10)} | đơn từ ${money(v.minOrderAmount).padStart(11)}đ | ${(v as any).maxDiscount ? `chặn ở ${money((v as any).maxDiscount)}đ` : ''.padEnd(18)} | ${v.startDate} → ${v.endDate}`);
  }
  console.log(`   … (${CODES.length} mã, xem SEED trong script để biết toàn bộ)`);

  console.log(`\nTạo mới: ${created} | Cập nhật: ${updated} | Bỏ qua vì đã tồn tại: ${skipped.length}${skipped.length ? ` (${skipped.join(', ')})` : ''}`);
  console.log(`Vouchers: ${before} -> ${await Voucher.countDocuments()}`);
  console.log(`Qua được bộ lọc getActive (nên hiện trong popup checkout): ${surfaced.length}/${CODES.length}`);
  console.log(`Đủ điều kiện cho giỏ ${money(DEMO_CART)}đ: ${eligibleForCart.length} — ${eligibleForCart.map((v: any) => v.code).join(', ')}`);
  if (surfaced.length !== CODES.length - skipped.length) {
    console.log('⚠️  Có mã không vượt được getActive — kiểm tra lại startDate/endDate/status.');
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
