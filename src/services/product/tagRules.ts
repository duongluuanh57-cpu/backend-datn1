import mongoose from 'mongoose';
import { Product } from '../../models/Product.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { Review } from '../../models/Review.ts';

/**
 * Luật gán tag dùng chung — nguồn duy nhất cho sync tag, query section và vòng đời
 * discount. Tag phải suy ra từ dữ liệu thật trong DB, không gán theo cảm tính hay
 * theo "top N" cứng. Đổi số ở đây là đổi toàn hệ thống.
 */
export const TAG_RULES = {
  /** New: sản phẩm ra mắt (createdAt) trong vòng N ngày. */
  newWithinDays: 90,
  /** Bán chạy: đã bán từ N sản phẩm trở lên. */
  hotMinSold: 15,
  /** Bán chạy: điểm đánh giá trung bình (review visible) từ X trở lên. */
  hotMinRating: 4.5,
  /** Giới hạn: tổng tồn kho mọi biến thể tối đa N. */
  limitedMaxTotalStock: 20,
} as const;

/**
 * Nhận diện Tag Limited — viết một lần để sync tag, vòng đời discount và luồng ghi tag
 * không mỗi nơi một regex rồi lệch nhau.
 */
export const LIMITED_TAG_QUERY = {
  status: 'active',
  $or: [{ slug: /^limited$/i }, { name: /^limited$/i }, { name: /^phiên bản giới hạn$/i }],
};

/** Slug tag Giới hạn mà section homepage đọc. */
export const LIMITED_TAG_SLUGS: string[] = ['limited', 'gioi-han', 'gioi-han-dac-biet'];

/** 'limited' / 'Limited Edition' / slug do AI hay form gửi về đều tính là bản giới hạn. */
export function isLimitedTagRef(value: unknown): boolean {
  return String(value ?? '').toLowerCase().includes('limited');
}

/** Mốc thời gian: sản phẩm tạo sau ngày này còn được coi là hàng mới. */
export function newCutoffDate(now: Date = new Date()): Date {
  return new Date(now.getTime() - TAG_RULES.newWithinDays * 24 * 60 * 60 * 1000);
}

/**
 * Id sản phẩm đạt luật Bán chạy: còn hàng, soldCount >= 15 và rating trung bình >= 4.5.
 * Rating lấy đúng định nghĩa đang hiển thị trên card: trung bình các review `visible`.
 */
export async function findHotProductIds(): Promise<mongoose.Types.ObjectId[]> {
  const inStockIds = await ProductVariant.distinct('productId', { quantityInStock: { $gt: 0 } });
  const candidates = await Product.find({
    status: 'active',
    soldCount: { $gte: TAG_RULES.hotMinSold },
    _id: { $in: inStockIds },
  })
    .select('_id')
    .lean();

  if (candidates.length === 0) return [];

  const ids = candidates.map((p: any) => p._id);
  const rated = await Review.aggregate([
    { $match: { productId: { $in: ids }, status: 'visible' } },
    { $group: { _id: '$productId', avg: { $avg: '$rating' } } },
    { $match: { avg: { $gte: TAG_RULES.hotMinRating } } },
  ]);

  const hotIds = new Set(rated.map((r: any) => r._id.toString()));
  return ids.filter((id: any) => hotIds.has(id.toString()));
}

/**
 * Id sản phẩm đạt luật Giới hạn: tổng tồn kho các biến thể <= 20 (và còn hàng).
 * Sản phẩm hết hẳn hàng không phải "khan hiếm" nên không được gắn tag này.
 */
export async function findLimitedProductIds(): Promise<mongoose.Types.ObjectId[]> {
  const rows = await ProductVariant.aggregate<{ _id: mongoose.Types.ObjectId; total: number }>([
    { $group: { _id: '$productId', total: { $sum: '$quantityInStock' } } },
    { $match: { total: { $gt: 0, $lte: TAG_RULES.limitedMaxTotalStock } } },
  ]);

  if (rows.length === 0) return [];

  const active = await Product.find({
    status: 'active',
    _id: { $in: rows.map((r) => r._id) },
  })
    .select('_id')
    .lean();

  return active.map((p: any) => p._id);
}
