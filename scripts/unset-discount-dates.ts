// Dọn dữ liệu mồ côi: gỡ discountStartDate/discountEndDate khỏi collection `products`.
// Hai field này đã bị loại khỏi schema — discount giờ hoàn toàn do tag lifecycle + Flash Sale quyết định.
//
// Mặc định là DRY-RUN (chỉ đếm, không ghi). Thêm --apply để thực sự $unset.
//   corepack pnpm exec tsx scripts/unset-discount-dates.ts          # dry-run
//   corepack pnpm exec tsx scripts/unset-discount-dates.ts --apply  # ghi thật
import 'dotenv/config';
import mongoose from 'mongoose';

const APPLY = process.argv.includes('--apply');

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGO_URI is not defined in environment variables');

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
  console.log(`🍃 Connected. Mode: ${APPLY ? 'APPLY (ghi DB)' : 'DRY-RUN (chỉ đếm)'}`);

  // Dùng raw collection để vượt qua Mongoose strict-mode (schema không còn 2 field này).
  const coll = mongoose.connection.db!.collection('products');
  const filter = {
    $or: [{ discountStartDate: { $exists: true } }, { discountEndDate: { $exists: true } }],
  };

  const matched = await coll.countDocuments(filter);
  console.log(`📦 Sản phẩm còn chứa field ngày mồ côi: ${matched}`);

  if (matched === 0) {
    console.log('✅ Không có gì để dọn.');
  } else if (!APPLY) {
    console.log('👉 Chạy lại với --apply để $unset hai field này.');
  } else {
    const res = await coll.updateMany(filter, {
      $unset: { discountStartDate: '', discountEndDate: '' },
    });
    console.log(`✅ Đã $unset. matched=${res.matchedCount}, modified=${res.modifiedCount}`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('❌ Lỗi:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
