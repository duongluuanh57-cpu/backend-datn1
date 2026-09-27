/**
 * Seed 100 đơn hàng trải trên các user đang có trong DB, kèm đầy đủ dữ liệu liên quan
 * như một web bán hàng vận hành bình thường.
 *
 * Chạy:
 *   npx tsx scripts/seed-orders.ts                            # DRY-RUN (chỉ in, không ghi)
 *   npx tsx scripts/seed-orders.ts --yes                      # ghi thật
 *   npx tsx scripts/seed-orders.ts --purge --yes              # xoá seed + hoàn nguyên
 *   npx tsx scripts/seed-orders.ts --yes --only-seed-users    # chỉ user @seed.local
 *
 * Tác động dữ liệu:
 *   INSERT orders(+100), order_items, user_addresses, reward_transactions, reviews
 *   UPDATE users(totalSpent, memberTier, membershipRewardedTier, rewardPoints),
 *          product_variants(quantityInStock -= qty),
 *          products(soldCount += qty),
 *          vouchers(usedCount += 1, có thể status -> inactive)
 *   FILE   .backups/seed-orders-baseline.json
 *
 * An toàn: mặc định DRY-RUN. Đơn seed nhận diện qua paymentTxnRef prefix 'SEEDORD';
 * chạy lại --yes tự reset về baseline rồi seed lại (không nhân đôi).
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
import { Voucher } from '../src/models/Voucher.ts';
import { Order } from '../src/models/Order.ts';
import { OrderItem } from '../src/models/OrderItem.ts';
import { RewardTransaction } from '../src/models/RewardTransaction.ts';
import { Review } from '../src/models/Review.ts';
import { computeMemberTier } from '../src/utils/memberTier.ts';
import { calculateShippingFee } from '../src/utils/helpers.ts';
import { getEffectiveProductDiscounts } from '../src/services/product/productFormatterService.ts';

const COUNT = 100;
const REF_PREFIX = 'SEEDORD';
const SEED = 20260927;
const DAY = 86_400_000;
const BASELINE_FILE = path.resolve(process.cwd(), '.backups', 'seed-orders-baseline.json');

const WRITE = process.argv.includes('--yes');
const PURGE = process.argv.includes('--purge');
const ONLY_SEED_USERS = process.argv.includes('--only-seed-users');

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

const STATUS_PLAN: Array<[string, number]> = [
  ['delivered', 55], ['shipped', 12], ['processing', 10], ['pending', 15], ['cancelled', 8],
];

const NOTES = ['', '', 'Giao giờ hành chính', 'Gọi trước khi giao', 'Để bảo vệ nhận giúp', 'Hàng dễ vỡ, nhẹ tay'];

const COMMENT_POOL = [
  'Mùi thơm, lưu hương lâu, đóng gói cẩn thận.',
  'Giao hàng nhanh, sản phẩm chính hãng, sẽ mua lại.',
  'Hương hợp gu, nhưng lưu hương chưa được lâu như mong đợi.',
  'Đóng gói kỹ, có kèm túi quà, rất hài lòng.',
  'Mùi nhẹ nhàng, phù hợp đi làm hằng ngày.',
  'Giá tốt so với dung tích, dùng khá tiết kiệm.',
  'Thích mùi hương nhưng độ tỏa hơi chìm.',
  'Nhân viên tư vấn nhiệt tình, sản phẩm đúng mô tả.',
];

type Baseline = {
  capturedAt: string;
  users: { _id: string; totalSpent: number; memberTier: string; membershipRewardedTier: string; rewardPoints: number }[];
  variants: { _id: string; quantityInStock: number }[];
  products: { _id: string; soldCount: number }[];
  vouchers: { _id: string; usedCount: number; status: string }[];
  created: { addressIds: string[]; earnTxIds?: string[] };
};

function writeBaseline(b: Baseline) {
  fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(b, null, 2), 'utf8');
}
function readBaseline(): Baseline {
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) as Baseline;
}

async function captureBaseline(): Promise<Baseline> {
  const users = (await User.find().select('totalSpent memberTier membershipRewardedTier rewardPoints').lean()) as any[];
  const variants = (await ProductVariant.find().select('quantityInStock').lean()) as any[];
  const products = (await Product.find().select('soldCount').lean()) as any[];
  const vouchers = (await Voucher.find().select('usedCount status').lean()) as any[];
  const b: Baseline = {
    capturedAt: new Date().toISOString(),
    users: users.map((u) => ({ _id: String(u._id), totalSpent: u.totalSpent || 0, memberTier: u.memberTier || 'MEMBER', membershipRewardedTier: u.membershipRewardedTier || 'MEMBER', rewardPoints: u.rewardPoints || 0 })),
    variants: variants.map((v) => ({ _id: String(v._id), quantityInStock: v.quantityInStock || 0 })),
    products: products.map((p) => ({ _id: String(p._id), soldCount: p.soldCount || 0 })),
    vouchers: vouchers.map((v) => ({ _id: String(v._id), usedCount: v.usedCount || 0, status: v.status || 'active' })),
    created: { addressIds: [], earnTxIds: [] },
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
    await RewardTransaction.deleteMany({ $or: [{ orderId: { $in: orderIds } }, { description: { $regex: '^\[seed\]' } }] });
    await Order.deleteMany({ _id: { $in: orderIds } });
  }
  // Earn (loại txns không có orderId) phải xoá theo id đã ghi lúc ghi, vì
  // regex theo description không đáng tin.
  const earnIds = (b.created?.earnTxIds || []).map((id) => new mongoose.Types.ObjectId(id));
  if (earnIds.length) await RewardTransaction.deleteMany({ _id: { $in: earnIds } });

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
  if (b.vouchers?.length) {
    await Voucher.bulkWrite(b.vouchers.map((v) => ({
      updateOne: { filter: { _id: new mongoose.Types.ObjectId(v._id) }, update: { $set: { usedCount: v.usedCount, status: v.status } } },
    })) as any);
  }
  b.created = { addressIds: [], earnTxIds: [] };
  return b;
}

async function loadData() {
  const userFilter: any = { role: 'USER', status: 'active' };
  if (ONLY_SEED_USERS) userFilter.email = { $regex: '@seed\.local$' };
  const users = (await User.find(userFilter).select('username email fullName phoneNumber rewardPoints totalSpent').lean()) as any[];
  const products = (await Product.find({ status: 'active' }).select('name discountPercentage').lean()) as any[];
  const productIds = products.map((p) => p._id);
  const variants = (await ProductVariant.find({ productId: { $in: productIds }, quantityInStock: { $gt: 0 } }).select('productId size price quantityInStock').lean()) as any[];
  const payments = (await PaymentMethod.find({ code: { $in: ['cod', 'vnpay'] } }).select('code _id').lean()) as any[];
  const vouchers = (await Voucher.find({ status: 'active', voucherCategory: 'discount' }).lean()) as any[];
  const addresses = (await UserAddress.find({ userId: { $in: users.map((u) => u._id) } }).lean()) as any[];
  const discounts = productIds.length ? await getEffectiveProductDiscounts(productIds) : new Map<string, number>();
  return { users, products, variants, payments, vouchers, addresses, discounts };
}

async function buildPlan(data: any) {
  const { users, variants, payments, vouchers, addresses, discounts } = data;
  const codId = payments.find((p: any) => p.code === 'cod')?._id;
  const vnpayId = payments.find((p: any) => p.code === 'vnpay')?._id;
  if (!codId || !vnpayId) throw new Error('Thiếu payment_methods cod/vnpay — không seed được đơn.');
  if (!users.length) throw new Error('Không có user role=USER active — chạy scripts/seed-users.ts trước.');

  const originalStock = new Map<string, number>();
  const byProduct = new Map<string, any[]>();
  for (const v of variants) {
    originalStock.set(String(v._id), v.quantityInStock || 0);
    const key = String(v.productId);
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key)!.push(v);
  }
  const sellable = [...byProduct.keys()];
  if (!sellable.length) throw new Error('Không có product active nào còn variant tồn kho.');

  const buyers = users.slice(0, Math.max(1, Math.floor(users.length * 0.85)));
  const weights = buyers.map(() => 1 + Math.floor(rng() * 6));
  const cum: number[] = [];
  let acc = 0;
  for (const w of weights) { acc += w; cum.push(acc); }
  const totalW = acc;
  const pickBuyer = () => {
    const x = rng() * totalW;
    for (let i = 0; i < cum.length; i++) if (x < cum[i]) return buyers[i];
    return buyers[buyers.length - 1];
  };

  const statuses: string[] = [];
  for (const [s, n] of STATUS_PLAN) for (let i = 0; i < n; i++) statuses.push(s);
  for (let i = statuses.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = statuses[i]; statuses[i] = statuses[j]; statuses[j] = t; }

  const addrByUser = new Map<string, any>();
  for (const a of addresses) {
    const k = String(a.userId);
    if (!addrByUser.has(k) || a.isDefault) addrByUser.set(k, a);
  }

  const voucherRemaining = new Map<string, number>();
  for (const v of vouchers) voucherRemaining.set(String(v._id), Math.max(0, (v.maxUsage || 0) - (v.usedCount || 0)));

  const now = Date.now();
  const start = now - 180 * DAY;

  const orders: any[] = [];
  const items: any[] = [];
  const newAddresses: any[] = [];
  const reserved = new Map<string, number>();
  const soldAdds = new Map<string, number>();
  const voucherUse = new Map<string, number>();

  // Xu: cấp trước cho ~40% buyer (như trúng vòng quay) để đơn có số dư mà tiêu.
  const rewardTxns: any[] = [];
  const workingPoints = new Map<string, number>();
  for (const u of users) workingPoints.set(String(u._id), u.rewardPoints || 0);
  const earnCount = Math.floor(buyers.length * 0.4);
  for (let i = 0; i < earnCount; i++) {
    const u = buyers[i];
    const amount = ri(10, 500) * 100;
    const after = (workingPoints.get(String(u._id)) || 0) + amount;
    workingPoints.set(String(u._id), after);
    rewardTxns.push({
      _id: new mongoose.Types.ObjectId(),
      userId: u._id, type: 'earn', unit: 'points', amount, balanceAfter: after,
      source: 'minigame', description: '[seed] Thưởng vòng quay may mắn',
      createdAt: new Date(now - (200 + i) * DAY),
    });
  }

  for (let i = 0; i < COUNT; i++) {
    const user = pickBuyer();
    const status = statuses[i];
    const isCancelled = status === 'cancelled';
    const isCod = rng() >= 0.32;
    const paymentMethodId = isCod ? codId : vnpayId;
    const shippingMethod = rng() < 0.2 ? 'express' : 'standard';

    const itemCount = 1 + (rng() < 0.35 ? 1 : 0) + (rng() < 0.12 ? 1 : 0);
    const picked: any[] = [];
    const usedVariantIds = new Set<string>();
    let subtotal = 0;

    for (let k = 0; k < itemCount; k++) {
      let chosen: any = null;
      let qty = 0;
      for (let attempt = 0; attempt < 8 && !chosen; attempt++) {
        const pid = pick(sellable);
        const pool = (byProduct.get(pid) || []).filter((v: any) =>
          (originalStock.get(String(v._id)) || 0) - (reserved.get(String(v._id)) || 0) > 0 &&
          !usedVariantIds.has(String(v._id)));
        if (!pool.length) continue;
        const v = pick(pool);
        const avail = (originalStock.get(String(v._id)) || 0) - (reserved.get(String(v._id)) || 0);
        const want = Math.min(avail, ri(1, 2));
        if (want < 1) continue;
        chosen = v; qty = want;
      }
      if (!chosen) continue;
      usedVariantIds.add(String(chosen._id));
      if (!isCancelled) {
        reserved.set(String(chosen._id), (reserved.get(String(chosen._id)) || 0) + qty);
        soldAdds.set(String(chosen.productId), (soldAdds.get(String(chosen.productId)) || 0) + qty);
      }
      const disc = Number(discounts.get(String(chosen.productId)) || 0);
      const price = disc > 0 ? Math.round(chosen.price * (1 - disc / 100)) : chosen.price;
      subtotal += price * qty;
      picked.push({ productId: chosen.productId, productVariantId: chosen._id, price, discount: disc, quantity: qty });
    }
    if (!picked.length) continue;

    const { fee: shippingFee } = await calculateShippingFee(subtotal, shippingMethod);

    let voucherId: any = null;
    let voucherDiscount = 0;
    if (!isCancelled && vouchers.length && rng() < 0.22) {
      const candidates = vouchers.filter((v: any) => subtotal >= (v.minOrderAmount || 0) && (voucherRemaining.get(String(v._id)) || 0) > 0);
      if (candidates.length) {
        const v = pick(candidates);
        let d = v.type === 'percentage' ? Math.round(subtotal * (v.value / 100)) : v.value;
        if (v.type === 'percentage' && v.maxDiscount && d > v.maxDiscount) d = v.maxDiscount;
        d = Math.max(0, Math.min(d, subtotal));
        voucherId = v._id;
        voucherDiscount = d;
        voucherRemaining.set(String(v._id), (voucherRemaining.get(String(v._id)) || 0) - 1);
        voucherUse.set(String(v._id), (voucherUse.get(String(v._id)) || 0) + 1);
      }
    }

    const amountBeforeReward = Math.max(0, subtotal + shippingFee - voucherDiscount);
    let pointsUsed = 0;
    const balanceNow = workingPoints.get(String(user._id)) || 0;
    if (!isCancelled && balanceNow > 0 && rng() < 0.25) {
      pointsUsed = Math.max(0, Math.min(balanceNow, Math.floor(subtotal * 0.1)));
    }
    pointsUsed = Math.min(pointsUsed, amountBeforeReward);
    const totalAmount = Math.max(0, amountBeforeReward - pointsUsed);
    if (pointsUsed > 0) workingPoints.set(String(user._id), balanceNow - pointsUsed);

    let addr = addrByUser.get(String(user._id));
    if (!addr) {
      const base = pick(ADDRESS_POOL);
      addr = {
        _id: new mongoose.Types.ObjectId(),
        fullName: user.fullName || user.username,
        phoneNumber: user.phoneNumber || '09' + String(10000000 + i).slice(0, 8),
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

    const createdAt = new Date(Math.min(now - DAY, start + Math.floor(((i + rng() * 0.8) / COUNT) * 180 * DAY)));
    const updatedAt = new Date(createdAt.getTime() + ri(1, 10) * DAY);

    let paymentStatus = 'unpaid';
    if (isCancelled && !isCod) paymentStatus = 'refunded';
    else if (!isCod || status === 'delivered') paymentStatus = 'paid';

    const orderId = new mongoose.Types.ObjectId();
    orders.push({
      _id: orderId,
      userId: user._id,
      voucherId,
      paymentMethodId,
      receiveName: addr.fullName,
      phone: addr.phoneNumber,
      address: addressStr,
      note: pick(NOTES),
      shippingInfo: { customerName: addr.fullName, customerEmail: user.email || '', customerPhone: addr.phoneNumber, customerAddress: addressStr },
      totalAmount,
      shippingFee,
      rewardPointsUsed: pointsUsed,
      rewardPointsDiscount: pointsUsed,
      status,
      paymentStatus,
      bankCode: isCod ? undefined : pick(['NCB', 'VNPAYQR', 'VISA', 'MASTERCARD']),
      paymentTxnRef: REF_PREFIX + '-' + String(i + 1).padStart(4, '0'),
      paymentTransactionCode: paymentStatus === 'unpaid' ? '' : String(10000000 + ri(0, 89999999)),
      paidAt: paymentStatus === 'paid' ? new Date(createdAt.getTime() + ri(0, 6) * DAY) : paymentStatus === 'refunded' ? createdAt : undefined,
      trackingNumber: status === 'shipped' || status === 'delivered' ? 'VN' + ri(100000000, 999999999) : '',
      createdAt,
      updatedAt,
    });

    for (const it of picked) {
      items.push({
        _id: new mongoose.Types.ObjectId(),
        orderId,
        productId: it.productId,
        productVariantId: it.productVariantId,
        price: it.price,
        discount: it.discount,
        quantity: it.quantity,
        createdAt,
      });
    }

    if (pointsUsed > 0) {
      rewardTxns.push({
        userId: user._id, type: 'spend', unit: 'points', amount: pointsUsed,
        balanceAfter: workingPoints.get(String(user._id)) || 0,
        source: 'order', orderId, description: '[seed] Dùng xu khi đặt hàng',
        createdAt,
      });
    }
  }

  const reviews: any[] = [];
  for (const o of orders) {
    if (o.status !== 'delivered') continue;
    for (const it of items) {
      if (String(it.orderId) !== String(o._id)) continue;
      if (rng() >= 0.6) continue;
      const created = new Date(o.createdAt.getTime() + ri(2, 20) * DAY);
      reviews.push({
        userId: o.userId,
        productId: it.productId,
        orderItemId: it._id,
        rating: pick([5, 5, 5, 4, 4, 3]),
        comment: pick(COMMENT_POOL),
        images: [],
        isAnonymous: rng() < 0.2,
        status: 'visible',
        createdAt: created,
        updatedAt: created,
      });
    }
  }

  const deliveredByUser = new Map<string, number>();
  for (const o of orders) if (o.status === 'delivered') deliveredByUser.set(String(o.userId), (deliveredByUser.get(String(o.userId)) || 0) + o.totalAmount);
  const userUpdates = users.map((u: any) => {
    const totalSpent = (u.totalSpent || 0) + (deliveredByUser.get(String(u._id)) || 0);
    const tier = computeMemberTier(totalSpent);
    return { _id: u._id, totalSpent, memberTier: tier, membershipRewardedTier: tier, rewardPoints: workingPoints.get(String(u._id)) || 0 };
  });

  const variantFinal = variants.map((v: any) => ({ _id: v._id, quantityInStock: Math.max(0, (v.quantityInStock || 0) - (reserved.get(String(v._id)) || 0)) }));
  const voucherUpdates = vouchers
    .filter((v: any) => voucherUse.has(String(v._id)))
    .map((v: any) => {
      const usedCount = (v.usedCount || 0) + (voucherUse.get(String(v._id)) || 0);
      return { _id: v._id, usedCount, status: usedCount >= (v.maxUsage || 0) ? 'inactive' : 'active' };
    });

  return { orders, items, newAddresses, reviews, rewardTxns, userUpdates, variantFinal, soldAdds, voucherUpdates };
}

async function applyPlan(plan: any, baseline: Baseline) {
  if (plan.newAddresses.length) await UserAddress.insertMany(plan.newAddresses);
  baseline.created.addressIds = plan.newAddresses.map((a: any) => String(a._id));
  // Persist NGAY sau khi ghi địa chỉ: nếu các bước sau lỗi, id đã không mất và
  // --purge vẫn dọn hết (bài học từ lần chạy đầu bị lỗi giữa chừng).
  writeBaseline(baseline);

  const earn = plan.rewardTxns.filter((t: any) => t.type === 'earn');
  const spend = plan.rewardTxns.filter((t: any) => t.type !== 'earn');
  if (earn.length) {
    await RewardTransaction.insertMany(earn, { timestamps: false });
    baseline.created.earnTxIds = earn.map((t: any) => String(t._id));
    writeBaseline(baseline);
  }

  if (plan.orders.length) await Order.insertMany(plan.orders, { timestamps: false });
  if (plan.items.length) {
    await OrderItem.insertMany(plan.items.map((it: any) => ({
      _id: it._id, orderId: it.orderId, productVariantId: it.productVariantId,
      price: it.price, discount: it.discount, quantity: it.quantity, createdAt: it.createdAt,
    })), { timestamps: false });
  }
  if (spend.length) await RewardTransaction.insertMany(spend, { timestamps: false });
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
  if (plan.voucherUpdates.length) {
    await Voucher.bulkWrite(plan.voucherUpdates.map((v: any) => ({
      updateOne: { filter: { _id: v._id }, update: { $set: { usedCount: v.usedCount, status: v.status } } },
    })) as any);
  }

  writeBaseline(baseline);
}

function printSummary(plan: any) {
  const byStatus = new Map<string, number>();
  let deliveredRevenue = 0;
  let pointsUsed = 0;
  const buyers = new Set<string>();
  for (const o of plan.orders) {
    byStatus.set(o.status, (byStatus.get(o.status) || 0) + 1);
    buyers.add(String(o.userId));
    if (o.status === 'delivered') deliveredRevenue += o.totalAmount;
    pointsUsed += o.rewardPointsUsed || 0;
  }
  const earn = plan.rewardTxns.filter((t: any) => t.type === 'earn');
  const spend = plan.rewardTxns.filter((t: any) => t.type !== 'earn');
  const soldTotal = [...plan.soldAdds.values()].reduce((s: number, n: number) => s + n, 0);

  console.log('\n===== KẾ HOẠCH SEED =====');
  console.log(`Đơn: ${plan.orders.length} | dòng đơn: ${plan.items.length} | buyer: ${buyers.size}`);
  for (const [s, n] of byStatus) console.log(`  ${s.padEnd(11)} : ${n}`);
  console.log(`Doanh thu delivered : ${money(deliveredRevenue)}đ`);
  console.log(`Địa chỉ tạo mới     : ${plan.newAddresses.length}`);
  console.log(`Reward ledger       : earn ${earn.length} | spend ${spend.length} | xu đã dùng ${money(pointsUsed)}`);
  console.log(`Reviews             : ${plan.reviews.length} (đơn delivered)`);
  console.log(`Tồn kho             : ${plan.variantFinal.length} variant | soldCount += ${soldTotal}`);
  console.log(`Voucher             : ${plan.voucherUpdates.length} mã được dùng`);
  console.log('=========================');
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
      console.log(`DRY-RUN purge: sẽ xoá ${seededCount} đơn seed, ${b.created?.addressIds?.length || 0} địa chỉ seed và khôi phục counters. Thêm --yes để chạy.`);
      return;
    }
    const nb = await resetToBaseline(b);
    writeBaseline(nb);
    console.log(`✅ Đã purge: xoá ${seededCount} đơn seed + dữ liệu phụ thuộc, khôi phục counters từ baseline.`);
    return;
  }

  let baseline: Baseline;
  if (fs.existsSync(BASELINE_FILE)) {
    baseline = readBaseline();
    if (WRITE) {
      baseline = await resetToBaseline(baseline);
    } else {
      console.log('ℹ️  Đã có dữ liệu seed trước đó (baseline tồn tại). Dry-run tính chồng lên; chạy --yes sẽ tự reset trước khi seed.');
    }
  } else if (WRITE) {
    baseline = await captureBaseline();
    console.log('Đã lưu baseline trạng thái gốc vào ' + BASELINE_FILE);
  } else {
    baseline = { capturedAt: '', users: [], variants: [], products: [], vouchers: [], created: { addressIds: [], earnTxIds: [] } };
  }

  const data = await loadData();
  const plan = await buildPlan(data);
  printSummary(plan);

  if (!WRITE) {
    console.log('\nDRY-RUN: chưa ghi gì. Thêm --yes để áp dụng.');
    return;
  }

  await applyPlan(plan, baseline);
  console.log('\n✅ Đã ghi 100 đơn + dữ liệu liên quan. Baseline: ' + BASELINE_FILE);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => mongoose.disconnect());
