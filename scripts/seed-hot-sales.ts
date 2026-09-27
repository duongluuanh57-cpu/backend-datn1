/**
 * Seed lịch sử bán hàng THẬT cho section "Top sản phẩm bán chạy toàn sàn".
 *
 * Khác seed-best-sellers.ts (chỉ $set soldCount — bị bác vì 48 lượt bán mà 1 review
 * là dữ liệu tự mâu thuẫn): script này dựng đúng chuỗi như web vận hành thật:
 *   người mua (@seed.local) đặt đơn -> đơn delivered -> người mua viết review
 *   (gắn orderItemId) -> soldCount cộng dồn từ quantity trong đơn -> tồn kho trừ.
 *
 * Chạy:
 *   npx tsx scripts/seed-hot-sales.ts                # DRY-RUN (chỉ in kế hoạch)
 *   npx tsx scripts/seed-hot-sales.ts --yes          # ghi thật
 *   npx tsx scripts/seed-hot-sales.ts --purge --yes  # xoá seed + hoàn nguyên counters
 *
 * Tác động dữ liệu:
 *   INSERT orders, order_items, reviews, user_addresses (buyer thiếu địa chỉ)
 *   UPDATE users(totalSpent, memberTier, membershipRewardedTier),
 *          product_variants(quantityInStock -= qty, giữ >= 1),
 *          products(soldCount += qty)
 *   FILE   .backups/seed-hot-sales-baseline.json
 *
 * Đơn seed nhận diện qua paymentTxnRef prefix 'SEEDHOT'. Chạy lại --yes tự reset
 * về baseline rồi seed lại (không nhân đôi).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { User } from '../src/models/User.ts';
import { UserAddress } from '../src/models/UserAddress.ts';
import { Product } from '../src/models/Product.ts';
import { ProductVariant } from '../src/models/ProductVariant.ts';
import { PaymentMethod } from '../src/models/PaymentMethod.ts';
import { Order } from '../src/models/Order.ts';
import { OrderItem } from '../src/models/OrderItem.ts';
import { Review } from '../src/models/Review.ts';
import { computeMemberTier } from '../src/utils/memberTier.ts';
import { calculateShippingFee } from '../src/utils/helpers.ts';
import { getEffectiveProductDiscounts } from '../src/services/product/productFormatterService.ts';
import { TAG_RULES } from '../src/services/product/tagRules.ts';
import { DiscountLifecycleService } from '../src/services/product/discountLifecycleService.ts';
import { ProductService } from '../src/services/ProductService.ts';

const COUNT = 16;
const REF_PREFIX = 'SEEDHOT';
const SEED = 20260928;
const DAY = 86_400_000;
const BASELINE_FILE = path.resolve(process.cwd(), '.backups', 'seed-hot-sales-baseline.json');

/** Bậc lượt bán giảm dần cho bảng xếp hạng trông tự nhiên; mọi giá trị >= hotMinSold. */
const LADDER = [48, 44, 41, 38, 35, 32, 30, 28, 26, 24, 22, 21, 20, 19, 17, 15];

const WRITE = process.argv.includes('--yes');
const PURGE = process.argv.includes('--purge');

const money = (n: number) => (Number(n) || 0).toLocaleString('vi-VN');

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const ri = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];

const ADDRESS_POOL = [
  { province: 'Thành phố Hồ Chí Minh', district: 'Quận 1', ward: 'Phường Bến Nghé', address: '12 Lý Tự Trọng' },
  { province: 'Thành phố Hồ Chí Minh', district: 'Quận 3', ward: 'Phường Võ Thị Sáu', address: '45 Nguyễn Đình Chiểu' },
  { province: 'Thành phố Hồ Chí Minh', district: 'Quận 7', ward: 'Phường Tân Phú', address: '88 Nguyễn Thị Thập' },
  { province: 'Thành phố Hồ Chí Minh', district: 'Quận Bình Thạnh', ward: 'Phường 25', address: '231 Xô Viết Nghệ Tĩnh' },
  { province: 'Thành phố Hà Nội', district: 'Quận Hoàn Kiếm', ward: 'Phường Hàng Bạc', address: '10 Hàng Bạc' },
  { province: 'Thành phố Hà Nội', district: 'Quận Cầu Giấy', ward: 'Phường Dịch Vọng', address: '17 Trần Quốc Hoàn' },
  { province: 'Thành phố Hà Nội', district: 'Quận Đống Đa', ward: 'Phường Láng Hạ', address: '62 Nguyễn Chí Thanh' },
  { province: 'Thành phố Đà Nẵng', district: 'Quận Hải Châu', ward: 'Phường Thạch Thang', address: '03 Quang Trung' },
];

const NOTES = ['', '', 'Giao giờ hành chính', 'Gọi trước khi giao', 'Để bảo vệ nhận giúp', 'Hàng dễ vỡ, nhẹ tay', 'Quà tặng sinh nhật, gói giúp mình'];

const COMMENT_POOL = [
  'Mùi thơm sang, lưu hương lâu, đóng gói cẩn thận.',
  'Giao hàng nhanh, sản phẩm chính hãng, sẽ mua lại.',
  'Hương hợp gu, tỏa tốt trong 2 tiếng đầu, rất đáng tiền.',
  'Đóng gói kỹ, có kèm túi quà, rất hài lòng.',
  'Mùi nhẹ nhàng, phù hợp đi làm hằng ngày.',
  'Giá tốt so với dung tích, dùng khá tiết kiệm.',
  'Đúng mô tả, chai còn seal, date mới.',
  'Nhân viên tư vấn nhiệt tình, sản phẩm chuẩn auth.',
  'Mua lần hai rồi, lần nào cũng ưng.',
  'Xịt thử một cái là thấy khác hàng trôi nổi liền.',
];

type Baseline = {
  capturedAt: string;
  users: { _id: string; totalSpent: number; memberTier: string; membershipRewardedTier: string; rewardPoints: number }[];
  variants: { _id: string; quantityInStock: number }[];
  products: { _id: string; soldCount: number }[];
  created: { addressIds: string[] };
};

function writeBaseline(b: Baseline) {
  fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(b, null, 2), 'utf8');
}
function readBaseline(): Baseline {
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) as Baseline;
}

const EMPTY_BASELINE: Baseline = { capturedAt: '', users: [], variants: [], products: [], created: { addressIds: [] } };

async function captureBaseline(): Promise<Baseline> {
  const users = (await User.find({ email: { $regex: '@seed\\.local$' } }).select('totalSpent memberTier membershipRewardedTier rewardPoints').lean()) as any[];
  const variants = (await ProductVariant.find().select('quantityInStock').lean()) as any[];
  const products = (await Product.find().select('soldCount').lean()) as any[];
  const b: Baseline = {
    capturedAt: new Date().toISOString(),
    users: users.map((u) => ({ _id: String(u._id), totalSpent: u.totalSpent || 0, memberTier: u.memberTier || 'MEMBER', membershipRewardedTier: u.membershipRewardedTier || 'MEMBER', rewardPoints: u.rewardPoints || 0 })),
    variants: variants.map((v) => ({ _id: String(v._id), quantityInStock: v.quantityInStock || 0 })),
    products: products.map((p) => ({ _id: String(p._id), soldCount: p.soldCount || 0 })),
    created: { addressIds: [] },
  };
  writeBaseline(b);
  return b;
}

async function resetToBaseline(b: Baseline): Promise<Baseline> {
  const seeded = (await Order.find({ paymentTxnRef: { $regex: `^${REF_PREFIX}` } }).select('_id').lean()) as any[];
  const orderIds = seeded.map((o) => o._id);
  if (orderIds.length) {
    const itemDocs = (await OrderItem.find({ orderId: { $in: orderIds } }).select('_id').lean()) as any[];
    const itemIds = itemDocs.map((i) => i._id);
    if (itemIds.length) await Review.deleteMany({ orderItemId: { $in: itemIds } });
    await OrderItem.deleteMany({ orderId: { $in: orderIds } });
    await Order.deleteMany({ _id: { $in: orderIds } });
  }
  const addrIds = (b.created?.addressIds || []).map((id) => new mongoose.Types.ObjectId(id));
  if (addrIds.length) await UserAddress.deleteMany({ _id: { $in: addrIds } });

  if (b.users?.length) {
    await User.bulkWrite(b.users.map((u) => ({
      updateOne: { filter: { _id: new mongoose.Types.ObjectId(u._id) }, update: { $set: { totalSpent: u.totalSpent, memberTier: u.memberTier, membershipRewardedTier: u.membershipRewardedTier, rewardPoints: u.rewardPoints } } },
    })) as any);
  }
  if (b.variants?.length) {
    await ProductVariant.bulkWrite(b.variants.map((v) => ({
      updateOne: { filter: { _id: new mongoose.Types.ObjectId(v._id) }, update: { $set: { quantityInStock: v.quantityInStock } } },
    })) as any);
  }
  if (b.products?.length) {
    await Product.bulkWrite(b.products.map((p) => ({
      updateOne: { filter: { _id: new mongoose.Types.ObjectId(p._id) }, update: { $set: { soldCount: p.soldCount } } },
    })) as any);
  }
  b.created = { addressIds: [] };
  return b;
}

/**
 * Chai ứng viên: active, còn hàng, review visible trung bình >= hotMinRating —
 * đúng các cổng của luật Bán chạy (tagRules.ts) trừ soldCount. Kèm dung lượng
 * tồn kho có thể bán (giữ mỗi variant >= 1 chai) để biết chai nào kham nổi bậc ladder.
 */
async function findCandidates() {
  const variants = (await ProductVariant.find({ quantityInStock: { $gt: 0 } }).select('productId size price quantityInStock').lean()) as any[];
  const byProduct = new Map<string, any[]>();
  for (const v of variants) {
    const key = String(v.productId);
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key)!.push(v);
  }
  const rated = await Review.aggregate<{ _id: mongoose.Types.ObjectId; avg: number; count: number }>([
    { $match: { status: 'visible' } },
    { $group: { _id: '$productId', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    { $match: { avg: { $gte: TAG_RULES.hotMinRating } } },
  ]);
  const avgById = new Map(rated.map((r) => [String(r._id), r]));

  const inStockIds = [...byProduct.keys()].map((id) => new mongoose.Types.ObjectId(id));
  const products = await Product.find({ status: 'active', _id: { $in: inStockIds } }).select('name soldCount').lean();

  return products
    .filter((p: any) => avgById.has(String(p._id)))
    .map((p: any) => {
      const vars = byProduct.get(String(p._id)) || [];
      // Mỗi variant giữ lại >= 1 chai để cổng "còn hàng" không bị seed phá.
      const capacity = vars.reduce((s: number, v: any) => s + Math.max(0, (v.quantityInStock || 0) - 1), 0);
      return { ...p, avgRating: avgById.get(String(p._id))!.avg, reviewCount: avgById.get(String(p._id))!.count, variants: vars, capacity };
    })
    .sort((a: any, b: any) =>
      (b.soldCount || 0) - (a.soldCount || 0) ||
      b.avgRating - a.avgRating ||
      String(a._id).localeCompare(String(b._id)),
    );
}

async function loadData() {
  const users = (await User.find({ role: 'USER', status: 'active', email: { $regex: '@seed\\.local$' } }).select('username email fullName phoneNumber rewardPoints totalSpent').lean()) as any[];
  if (!users.length) throw new Error('Không có user @seed.local nào — chạy scripts/seed-users.ts trước.');
  const payments = (await PaymentMethod.find({ code: { $in: ['cod', 'vnpay'] } }).select('code _id').lean()) as any[];
  const addresses = (await UserAddress.find({ userId: { $in: users.map((u) => u._id) } }).lean()) as any[];
  return { users, payments, addresses };
}

async function buildPlan(data: any, candidates: any[]) {
  const { users, payments, addresses } = data;
  const codId = payments.find((p: any) => p.code === 'cod')?._id;
  const vnpayId = payments.find((p: any) => p.code === 'vnpay')?._id;
  if (!codId || !vnpayId) throw new Error('Thiếu payment_methods cod/vnpay — không seed được đơn.');

  // Ghép bậc ladder với chai đủ dung lượng tồn kho cho bậc đó.
  const targets: { product: any; targetSold: number }[] = [];
  const used = new Set<string>();
  for (let slot = 0; slot < LADDER.length && targets.length < COUNT; slot++) {
    const want = LADDER[slot];
    const c = candidates.find((p: any) => {
      const key = String(p._id);
      if (used.has(key)) return false;
      const required = Math.max(0, want - (p.soldCount || 0));
      return p.capacity >= required + 2; // dư chút để đơn không vét sạch kho
    });
    if (!c) continue;
    used.add(String(c._id));
    targets.push({ product: c, targetSold: want });
  }
  if (!targets.length) throw new Error('Không chai nào đạt cổng rating + đủ tồn kho — không seed được.');

  const discounts = await getEffectiveProductDiscounts(targets.map((t) => t.product._id));

  // Avg review visible hiện có của từng chai mục tiêu — để rating mới không kéo
  // chai đang sát mốc 4.5 xuống dưới cổng hotMinRating.
  const ratingAgg = await Review.aggregate<{ _id: mongoose.Types.ObjectId; sum: number; n: number }>([
    { $match: { status: 'visible', productId: { $in: targets.map((t) => t.product._id) } } },
    { $group: { _id: '$productId', sum: { $sum: '$rating' }, n: { $sum: 1 } } },
  ]);
  const aggBy = new Map(ratingAgg.map((r) => [String(r._id), { sum: r.sum, n: r.n }]));

  const addrByUser = new Map<string, any>();
  for (const a of addresses) {
    const k = String(a.userId);
    if (!addrByUser.has(k) || a.isDefault) addrByUser.set(k, a);
  }

  // Buyer nặng-nhẹ khác nhau như seed-orders: người mua 1 lần, người là khách ruột.
  const weights = users.map(() => 1 + Math.floor(rng() * 6));
  const cum: number[] = [];
  let acc = 0;
  for (const w of weights) { acc += w; cum.push(acc); }
  const totalW = acc;
  const pickBuyer = () => {
    const x = rng() * totalW;
    for (let i = 0; i < cum.length; i++) if (x < cum[i]) return users[i];
    return users[users.length - 1];
  };

  const now = Date.now();
  const orders: any[] = [];
  const items: any[] = [];
  const reviews: any[] = [];
  const newAddresses: any[] = [];
  const reserved = new Map<string, number>();
  const soldAdds = new Map<string, number>();
  const workingPoints = new Map<string, number>();
  for (const u of users) workingPoints.set(String(u._id), u.rewardPoints || 0);

  let seq = 0;
  const perProduct: { name: string; sold: number; orderCount: number; reviewCount: number }[] = [];

  for (const { product, targetSold } of targets) {
    const pid = String(product._id);
    const required = Math.max(1, targetSold - (product.soldCount || 0));
    let placed = 0;
    let orderCount = 0;
    let reviewCount = 0;

    while (placed < required) {
      const user = pickBuyer();
      const pool = (product.variants || []).filter((v: any) =>
        (v.quantityInStock || 0) - (reserved.get(String(v._id)) || 0) >= 2);
      if (!pool.length) break; // hết chỗ bán mà vẫn giữ mỗi variant >= 1
      const v = pick(pool);
      const avail = (v.quantityInStock || 0) - (reserved.get(String(v._id)) || 0) - 1;
      const qty = Math.min(avail, required - placed, rng() < 0.72 ? 1 : 2);
      if (qty < 1) break;
      reserved.set(String(v._id), (reserved.get(String(v._id)) || 0) + qty);
      soldAdds.set(pid, (soldAdds.get(pid) || 0) + qty);
      placed += qty;

      // 88% delivered (sinh ra review), còn lại shipped/processing cho giống sàn thật.
      const roll = rng();
      const status = roll < 0.88 ? 'delivered' : roll < 0.95 ? 'shipped' : 'processing';
      const isCod = rng() >= 0.32;
      const paymentMethodId = isCod ? codId : vnpayId;
      const shippingMethod = rng() < 0.2 ? 'express' : 'standard';

      const disc = Number(discounts.get(pid) || 0);
      const price = disc > 0 ? Math.round(v.price * (1 - disc / 100)) : v.price;
      const subtotal = price * qty;
      const { fee: shippingFee } = await calculateShippingFee(subtotal, shippingMethod);

      let paymentStatus = 'unpaid';
      if (!isCod || status === 'delivered') paymentStatus = 'paid';
      const totalAmount = Math.max(0, subtotal + shippingFee);

      let addr = addrByUser.get(String(user._id));
      if (!addr) {
        const base = pick(ADDRESS_POOL);
        addr = {
          _id: new mongoose.Types.ObjectId(),
          fullName: user.fullName || user.username,
          phoneNumber: user.phoneNumber || '09' + String(10000000 + seq).slice(0, 8),
          ...base,
        };
        newAddresses.push({
          _id: addr._id, userId: user._id, addressType: 'home',
          fullName: addr.fullName, phoneNumber: addr.phoneNumber,
          address: addr.address, province: addr.province, district: addr.district, ward: addr.ward,
          isDefault: true,
        });
        addrByUser.set(String(user._id), addr);
      }
      const addressStr = [addr.address, addr.ward, addr.district, addr.province].filter(Boolean).join(', ');

      // Đơn delivered phải đủ cũ để timeline giao + đánh giá nằm trong quá khứ.
      const ageDays = status === 'delivered' ? ri(30, 150) : ri(3, 20);
      const createdAt = new Date(now - ageDays * DAY - ri(0, 20) * 3_600_000);
      const deliveredOffset = ri(3, 8) * DAY;
      const updatedAt = new Date(Math.min(now - DAY, createdAt.getTime() + deliveredOffset + ri(0, 3) * DAY));

      const orderId = new mongoose.Types.ObjectId();
      seq++;
      orderCount++;
      orders.push({
        _id: orderId,
        userId: user._id,
        voucherId: null,
        paymentMethodId,
        receiveName: addr.fullName,
        phone: addr.phoneNumber,
        address: addressStr,
        note: pick(NOTES),
        shippingInfo: { customerName: addr.fullName, customerEmail: user.email || '', customerPhone: addr.phoneNumber, customerAddress: addressStr },
        totalAmount,
        shippingFee,
        rewardPointsUsed: 0,
        rewardPointsDiscount: 0,
        status,
        paymentStatus,
        bankCode: isCod ? undefined : pick(['NCB', 'VNPAYQR', 'VISA', 'MASTERCARD']),
        paymentTxnRef: REF_PREFIX + '-' + String(seq).padStart(4, '0'),
        paymentTransactionCode: paymentStatus === 'unpaid' ? '' : String(10000000 + ri(0, 89999999)),
        paidAt: paymentStatus === 'paid' ? new Date(createdAt.getTime() + ri(0, 2) * DAY) : undefined,
        trackingNumber: status === 'shipped' || status === 'delivered' ? 'VN' + ri(100000000, 999999999) : '',
        createdAt,
        updatedAt,
      });

      const itemId = new mongoose.Types.ObjectId();
      items.push({
        _id: itemId,
        orderId,
        productId: new mongoose.Types.ObjectId(pid),
        productVariantId: v._id,
        price,
        discount: disc,
        quantity: qty,
        createdAt,
      });

      // Luật thật (ReviewService.canReview): mỗi lượt mua delivered = 1 lượt review.
      // Mỗi đơn seed là 1 lượt mua nên review tối đa 1 cái/đơn — không giới hạn theo cặp user+product.
      if (status === 'delivered' && rng() < 0.78) {
        const agg = aggBy.get(pid) || { sum: 0, n: 0 };
        let rating = 5;
        if (rng() < 0.25 && (agg.sum + 4) / (agg.n + 1) >= 4.6) rating = 4;
        agg.sum += rating; agg.n += 1;
        aggBy.set(pid, agg);
        const reviewed = new Date(Math.min(now - DAY, createdAt.getTime() + deliveredOffset + ri(1, 12) * DAY));
        reviews.push({
          userId: user._id,
          productId: new mongoose.Types.ObjectId(pid),
          orderItemId: itemId,
          rating,
          comment: pick(COMMENT_POOL),
          images: [],
          isAnonymous: rng() < 0.15,
          status: 'visible',
          createdAt: reviewed,
          updatedAt: reviewed,
        });
        reviewCount++;
      }
    }
    perProduct.push({ name: product.name, sold: product.soldCount || 0, orderCount, reviewCount });
  }

  // totalSpent + tier cập nhật từ đơn delivered (đúng convention dashboard).
  const deliveredByUser = new Map<string, number>();
  for (const o of orders) if (o.status === 'delivered') deliveredByUser.set(String(o.userId), (deliveredByUser.get(String(o.userId)) || 0) + o.totalAmount);
  const userUpdates = users
    .filter((u: any) => deliveredByUser.has(String(u._id)))
    .map((u: any) => {
      const totalSpent = (u.totalSpent || 0) + (deliveredByUser.get(String(u._id)) || 0);
      const tier = computeMemberTier(totalSpent);
      return { _id: u._id, totalSpent, memberTier: tier, membershipRewardedTier: tier, rewardPoints: u.rewardPoints || 0 };
    });

  const variantFinal = [...reserved.entries()].map(([vid, qty]) => {
    const v = candidates.flatMap((c) => c.variants).find((x: any) => String(x._id) === vid);
    return { _id: new mongoose.Types.ObjectId(vid), quantityInStock: Math.max(1, (v?.quantityInStock || 0) - qty) };
  });

  return { targets, orders, items, reviews, newAddresses, userUpdates, variantFinal, soldAdds, perProduct };
}

async function applyPlan(plan: any, baseline: Baseline) {
  if (plan.newAddresses.length) await UserAddress.insertMany(plan.newAddresses);
  baseline.created.addressIds = plan.newAddresses.map((a: any) => String(a._id));
  writeBaseline(baseline);

  if (plan.orders.length) await Order.insertMany(plan.orders, { timestamps: false });
  if (plan.items.length) await OrderItem.insertMany(plan.items, { timestamps: false });
  if (plan.reviews.length) await Review.insertMany(plan.reviews, { timestamps: false });

  if (plan.userUpdates.length) {
    await User.bulkWrite(plan.userUpdates.map((u: any) => ({
      updateOne: { filter: { _id: u._id }, update: { $set: { totalSpent: u.totalSpent, memberTier: u.memberTier, membershipRewardedTier: u.membershipRewardedTier, rewardPoints: u.rewardPoints } } },
    })) as any);
  }
  if (plan.variantFinal.length) {
    await ProductVariant.bulkWrite(plan.variantFinal.map((v: any) => ({
      updateOne: { filter: { _id: v._id }, update: { $set: { quantityInStock: v.quantityInStock } } },
    })) as any);
  }
  const soldOps = [...plan.soldAdds.entries()].map(([pid, add]) => ({
    updateOne: { filter: { _id: new mongoose.Types.ObjectId(pid) }, update: { $inc: { soldCount: add } } },
  }));
  if (soldOps.length) await Product.bulkWrite(soldOps as any);

  writeBaseline(baseline);
}

function printSummary(plan: any) {
  const buyers = new Set<string>(plan.orders.map((o: any) => String(o.userId)));
  const byStatus = new Map<string, number>();
  for (const o of plan.orders) byStatus.set(o.status, (byStatus.get(o.status) || 0) + 1);
  const soldTotal = [...plan.soldAdds.values()].reduce((s: number, n: number) => s + n, 0);

  console.log('\n===== KẾ HOẠCH SEED HOT SALES =====');
  console.log(`Sản phẩm mục tiêu : ${plan.targets.length}/${COUNT}`);
  console.log(`Đơn: ${plan.orders.length} | dòng đơn: ${plan.items.length} | buyer: ${buyers.size}`);
  for (const [s, n] of byStatus) console.log(`  ${s.padEnd(11)} : ${n}`);
  console.log(`Reviews mới       : ${plan.reviews.length} (từ đơn delivered, gắn orderItemId)`);
  console.log(`Địa chỉ tạo mới   : ${plan.newAddresses.length}`);
  console.log(`soldCount += ${soldTotal} | tồn kho trừ ở ${plan.variantFinal.length} variant (giữ >= 1)`);
  console.log('\n  # | sold cũ -> mới | đơn | review mới | sản phẩm');
  plan.perProduct.forEach((p: any, i: number) => {
    const target = plan.targets[i] ? plan.targets[i].targetSold : '?';
    console.log(`  ${String(i + 1).padStart(2)} | ${String(p.sold).padStart(3)} -> ${String(target).padStart(3)} | ${String(p.orderCount).padStart(3)} | ${String(p.reviewCount).padStart(3)} | ${String(p.name).slice(0, 44)}`);
  });
  console.log('===================================');
}

async function clearCaches() {
  const cleared = await DiscountLifecycleService.clearDiscountCaches();
  console.log(`Đã xoá ${cleared} key cache redis (products:trending:*, homepage:*, graphql:*).`);
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error('Thiếu MONGO_URI trong .env');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30000 });

  if (PURGE) {
    if (!fs.existsSync(BASELINE_FILE)) {
      console.log('Không có baseline — chưa từng seed, không có gì để hoàn nguyên.');
      return;
    }
    const b = readBaseline();
    const seededCount = await Order.countDocuments({ paymentTxnRef: { $regex: `^${REF_PREFIX}` } });
    if (!WRITE) {
      console.log(`DRY-RUN purge: sẽ xoá ${seededCount} đơn seed + review/địa chỉ phụ thuộc và khôi phục counters. Thêm --yes để chạy.`);
      return;
    }
    const nb = await resetToBaseline(b);
    writeBaseline(nb);
    await clearCaches();
    console.log(`✅ Đã purge: xoá ${seededCount} đơn SEEDHOT + dữ liệu phụ thuộc, khôi phục counters từ baseline.`);
    return;
  }

  let baseline: Baseline;
  if (fs.existsSync(BASELINE_FILE)) {
    baseline = readBaseline();
    if (WRITE) {
      baseline = await resetToBaseline(baseline);
      console.log('ℹ️  Đã reset dữ liệu SEEDHOT cũ về baseline trước khi seed lại.');
    } else {
      console.log('ℹ️  Đã có dữ liệu seed trước đó (baseline tồn tại). Dry-run tính chồng lên; chạy --yes sẽ tự reset trước khi seed.');
    }
  } else if (WRITE) {
    baseline = await captureBaseline();
    console.log('Đã lưu baseline trạng thái gốc vào ' + BASELINE_FILE);
  } else {
    baseline = EMPTY_BASELINE;
  }

  const candidates = await findCandidates();
  console.log(`Chai đạt cổng rating (>= ${TAG_RULES.hotMinRating}) + còn hàng: ${candidates.length}`);
  const data = await loadData();
  const plan = await buildPlan(data, candidates);
  printSummary(plan);

  if (!WRITE) {
    console.log('\nDRY-RUN: chưa ghi gì. Thêm --yes để áp dụng.');
    return;
  }

  await applyPlan(plan, baseline);
  await clearCaches();

  const hot = await ProductService.getTrendingProducts(COUNT);
  console.log(`\n✅ Đã ghi ${plan.orders.length} đơn + ${plan.reviews.length} review + counters. Baseline: ${BASELINE_FILE}`);
  console.log(`getTrendingProducts(${COUNT}) trả về: ${hot.length} chai`);
  if (hot.length === 0) console.log('❌ Vẫn rỗng — kiểm tra flash sale đang giữ hết candidate hoặc cache chưa xoá.');
  console.log('   (BE giữ homepage cache trong RAM tiến trình nên cần restart backend để SSR trang chủ dựng lại.)');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => mongoose.disconnect());
