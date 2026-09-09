import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { connectDB } from '../config/database.ts';
import { redis } from '../config/redis.ts';
import { Tag } from '../models/Tag.ts';
import { Product } from '../models/Product.ts';
import { ProductTag } from '../models/ProductTag.ts';
import { Review } from '../models/Review.ts';
import { User } from '../models/User.ts';

const SAMPLE_REVIEWS = [
  { rating: 5, comment: 'Mùi hương tuyệt vời, giữ mùi lâu và rất sang trọng!' },
  { rating: 5, comment: 'Hàng chính hãng, đóng gói rất cẩn thận, sẽ ủng hộ shop tiếp.' },
  { rating: 4, comment: 'Mùi thơm dễ chịu, tươi mát, thích hợp dùng ban ngày.' },
  { rating: 5, comment: 'Độ toả hương tốt, ai cũng khen thơm. Đáng tiền!' },
  { rating: 4, comment: 'Rất ưng ý, tone mùi thanh lịch và cuốn hút.' },
];

async function main() {
  console.log('🚀 [Seed 20 New Products] Bắt đầu chuẩn hóa 20 sản phẩm mới trong DB...');
  await connectDB();

  // 1. Lấy Tag New và Standard
  let newTag = await Tag.findOne({
    status: 'active',
    $or: [{ slug: /^new$/i }, { name: /^sản phẩm mới$/i }],
  });
  if (!newTag) {
    newTag = await Tag.create({ name: 'Sản phẩm mới', slug: 'New', status: 'active' });
  }

  let standardTag = await Tag.findOne({
    status: 'active',
    $or: [{ slug: /^standard$/i }, { name: /^tiêu chuẩn$/i }],
  });
  if (!standardTag) {
    standardTag = await Tag.create({ name: 'Tiêu chuẩn', slug: 'Standard', status: 'active' });
  }

  // 2. Lấy 20 sản phẩm mục tiêu (ưu tiên các sản phẩm đang có liên kết với tag New)
  const currentNewLinks = await ProductTag.find({ tagId: newTag._id }).lean();
  let targetProductIds: mongoose.Types.ObjectId[] = currentNewLinks.map(l => l.productId);

  // Nếu nhiều hơn 20, lấy đúng 20 sản phẩm đầu tiên, các sản phẩm còn lại sẽ chuyển sang Standard
  let overflowProductIds: mongoose.Types.ObjectId[] = [];
  if (targetProductIds.length > 20) {
    overflowProductIds = targetProductIds.slice(20);
    targetProductIds = targetProductIds.slice(0, 20);
  }

  // Nếu ít hơn 20, lấy thêm các sản phẩm active khác trong DB
  if (targetProductIds.length < 20) {
    const additional = await Product.find({
      status: 'active',
      _id: { $nin: targetProductIds },
    })
      .limit(20 - targetProductIds.length)
      .select('_id')
      .lean();
    targetProductIds.push(...additional.map(p => p._id));
  }

  console.log(`📦 Đã chọn đúng 20 sản phẩm để chuẩn hóa ngày hôm nay và lượt bán.`);

  // 3. Xử lý các sản phẩm dôi dư (> 20): gỡ tag New và gán tag Standard
  if (overflowProductIds.length > 0) {
    await ProductTag.deleteMany({
      productId: { $in: overflowProductIds },
      tagId: newTag._id,
    });
    for (const pId of overflowProductIds) {
      const hasStandard = await ProductTag.exists({ productId: pId, tagId: standardTag._id });
      if (!hasStandard) {
        await ProductTag.create({ productId: pId, tagId: standardTag._id });
      }
    }
    await Product.updateMany(
      { _id: { $in: overflowProductIds } },
      { $set: { isNewArrival: false } }
    );
    console.log(`ℹ️ Đã chuyển ${overflowProductIds.length} sản phẩm dư từ Tag New sang Tag Standard.`);
  }

  // 4. Lấy một user làm tác giả cho review nếu cần thêm review
  let sampleUser = await User.findOne().lean();

  // 5. Danh sách phân bổ lượt bán tự nhiên: từ 1 đến 20 (cao nhất 20, thấp nhất 1)
  const soldCountDistribution = [
    20, 19, 18, 16, 15, 14, 12, 11, 10, 9,
    8, 7, 6, 5, 4, 3, 3, 2, 2, 1
  ];

  const now = Date.now();

  for (let i = 0; i < targetProductIds.length; i++) {
    const pId = targetProductIds[i];
    // Đặt ngày tạo là hôm nay, cách nhau 3 phút để giữ thứ tự sắp xếp
    const createdAt = new Date(now - i * 3 * 60 * 1000);
    const soldCount = soldCountDistribution[i] || Math.floor(Math.random() * 20) + 1;

    // Đảm bảo liên kết ProductTag có tag New
    await ProductTag.updateOne(
      { productId: pId, tagId: newTag._id },
      { $setOnInsert: { productId: pId, tagId: newTag._id } },
      { upsert: true }
    );
    // QUY TẮC: Tag Standard KHÔNG THỂ đứng chung với New -> XÓA Tag Standard nếu có
    await ProductTag.deleteMany({ productId: pId, tagId: standardTag._id });

    // Cập nhật Product: createdAt hôm nay, soldCount trong [1..20], isNewArrival = true
    await Product.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(pId.toString()) },
      {
        $set: {
          soldCount,
          discountPercentage: 5,
          isNewArrival: true,
          createdAt,
          updatedAt: new Date(now - i * 3 * 60 * 1000),
          status: 'active',
        },
      }
    );

    // Xử lý đánh giá (Review):
    // Đảm bảo số lượng review nằm trong khoảng 1 đến 20
    const existingReviews = await Review.find({ productId: pId }).lean();
    if (existingReviews.length > 20) {
      // Giảm bớt review thừa nếu quá 20
      const excessIds = existingReviews.slice(20).map(r => r._id);
      await Review.deleteMany({ _id: { $in: excessIds } });
    } else if (existingReviews.length === 0 && sampleUser) {
      // Nếu chưa có review, tạo 1 đến 2 review để có đánh giá (1..20)
      const numReviews = (i % 3) + 1; // 1, 2 hoặc 3 reviews
      for (let r = 0; r < numReviews; r++) {
        const rev = SAMPLE_REVIEWS[(i + r) % SAMPLE_REVIEWS.length];
        await Review.create({
          userId: sampleUser._id,
          productId: pId,
          rating: rev.rating,
          comment: rev.comment,
          status: 'visible',
          aspects: [
            { name: 'quality', rating: 5, comment: 'Tốt' },
            { name: 'scent', rating: 5, comment: 'Thơm' },
          ],
          createdAt: new Date(now - (i * 3 + r + 1) * 60 * 1000),
        });
      }
    }

    const finalReviewsCount = await Review.countDocuments({ productId: pId, status: 'visible' });
    const prodDoc = await Product.findById(pId).select('name').lean();
    console.log(
      `  [${i + 1}/20] ${prodDoc?.name || pId} | createdAt: Hôm nay (${createdAt.toLocaleTimeString()}) | soldCount: ${soldCount} | reviews: ${finalReviewsCount}`
    );
  }

  // 6. Xóa Redis Cache
  try {
    const keysToDelete = [
      'homepage:v7',
      'products:new:tag:v5',
      'products:new:tag:v6',
      'products:new:v6:15',
      'products:new:v6:20',
      'products:trending:tag:v5',
      'products:trending:v6:15',
      'products:limited:tag:v4',
    ];
    for (const k of keysToDelete) {
      await redis.del(k);
    }
    const streamKeys = await redis.keys('products:new:*');
    if (streamKeys.length > 0) {
      for (const k of streamKeys) await redis.del(k);
    }
    const homeKeys = await redis.keys('homepage:*');
    if (homeKeys.length > 0) {
      for (const k of homeKeys) await redis.del(k);
    }
    console.log('🧹 Đã xóa sạch cache Redis liên quan!');
  } catch (err) {
    console.warn('⚠️ Lỗi xóa Redis cache:', err);
  }

  console.log('\n======================================================');
  console.log('🎉 HOÀN THÀNH: Đã chuẩn hóa 20 sản phẩm mới tạo hôm nay với lượt bán 1..20 và đánh giá hợp lệ!');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error('❌ Thất bại:', e);
  await mongoose.disconnect();
  process.exit(1);
});
