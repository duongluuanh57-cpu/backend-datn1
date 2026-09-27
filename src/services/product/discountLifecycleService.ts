import mongoose from 'mongoose';
import { Product } from '../../models/Product.ts';
import { Tag } from '../../models/Tag.ts';
import { ProductTag } from '../../models/ProductTag.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { redis } from '../../config/redis.ts';
import { FlashSaleService } from '../FlashSaleService.ts';
import { TAG_RULES, LIMITED_TAG_QUERY } from './tagRules.ts';

/**
 * DiscountLifecycleService — MÔ HÌNH TRUNG TÂM duy nhất gán discount theo Tag.
 *
 * - Bảng quy tắc ghi cứng tại đây (nguồn duy nhất). Tag không có trong bảng = 0,
 *   tức hệ thống không tự gán gì thêm. Hiện tại: CHỈ hàng Tag New được 5%.
 * - Ghi THẲNG vào dữ liệu sản phẩm trên DB (discountPercentage + cờ autoDiscount),
 *   nên badge hiện ở mọi section đọc cùng nguồn (Mới, Mùa, Hot Trend...).
 * - Section Sản Phẩm Mới Về chỉ còn lo tag (gán New / chuyển Standard), không đụng discount.
 *
 * LUẬT ƯU TIÊN (mạnh -> yếu), khi Standard đứng chung tag khác thì lấy discount tag đó:
 *   Flash Sale (hệ riêng) > khuyến mãi thật (giữ nguyên) > New (5%) >
 *   Limited (khan hiếm 0-5%) / Sale (giữ nguyên, không đụng) >
 *   Standard (công thức, trần 15%) > 0.
 * Tag Trending chỉ đánh dấu top bán chạy, không bao giờ sinh discount nên đứng ngoài bảng.
 */

export const TAG_DISCOUNT_POLICY: Record<string, number> = {
  new: 5,
};

export const NEW_AUTO_DISCOUNT_PERCENT = TAG_DISCOUNT_POLICY.new;

/** Trần discount hệ thống cho hàng Standard. */
export const STANDARD_MAX_DISCOUNT = 15;

const AUTO_LIFECYCLE_DAYS = TAG_RULES.newWithinDays;
const THROTTLE_MS = 600_000;

export interface DiscountCycleResult {
  assigned: number;
  reclaimed: number;
  reclaimedFlagOnly: number;
  skippedHasDiscount: number;
  skippedFlashSaleOrLimited: number;
  standardAssigned: number;
  standardLevels: Record<string, number>;
  skippedStandardOOS: number;
  skippedStandardPromo: number;
  skippedStandardExcluded: number;
  limitedAssigned: number;
  limitedLevels: Record<string, number>;
  skippedLimitedOOS: number;
  skippedLimitedPromo: number;
  skippedLimitedExcluded: number;
}

export interface DiscountPreview extends DiscountCycleResult {
  sampleAssign: string[];
  sampleReclaim: string[];
  sampleStandard: string[];
  sampleLimited: string[];
}

export interface StandardSignals {
  stock: number;
  ageDays: number;
  soldCount: number;
}

/**
 * Công thức discount hàng Standard — hàm thuần túy, tính lại bao nhiêu lần cũng ổn định.
 * Tồn kho + tuổi + sức bán, cộng dồn, chặn trần STANDARD_MAX_DISCOUNT.
 */
export function computeStandardDiscount(s: StandardSignals): number {
  let total = 0;
  if (s.stock > 100) total += 6;
  else if (s.stock >= 51) total += 4;
  else if (s.stock >= 21) total += 2;

  if (s.ageDays > 180) total += 5;
  else if (s.ageDays > 90) total += 3;
  else if (s.ageDays > 31) total += 1;

  const denom = s.soldCount + s.stock;
  if (s.soldCount === 0 && s.ageDays > 60) total += 5;
  else if (denom > 0) {
    const rate = s.soldCount / denom;
    if (rate < 0.1) total += 3;
    else if (rate <= 0.3) total += 1;
  }

  return Math.min(STANDARD_MAX_DISCOUNT, total);
}

const EMPTY_RESULT: DiscountCycleResult = {
  assigned: 0,
  reclaimed: 0,
  reclaimedFlagOnly: 0,
  skippedHasDiscount: 0,
  skippedFlashSaleOrLimited: 0,
  standardAssigned: 0,
  standardLevels: {},
  skippedStandardOOS: 0,
  skippedStandardPromo: 0,
  skippedStandardExcluded: 0,
  limitedAssigned: 0,
  limitedLevels: {},
  skippedLimitedOOS: 0,
  skippedLimitedPromo: 0,
  skippedLimitedExcluded: 0,
};

/**
 * Discount hàng Limited theo độ khan hiếm — hàm thuần túy, trần 5%.
 * Tồn càng ít càng ít giảm (giữ giá xa xỉ), tồn nhiều lên tới 5%.
 */
export function computeLimitedDiscount(stock: number): number {
  if (stock > 30) return 5;
  if (stock >= 11) return 3;
  if (stock >= 4) return 2;
  return 0;
}

async function findNewTag() {
  return Tag.findOne({
    status: 'active',
    $or: [{ slug: /^new$/i }, { name: /^sản phẩm mới$/i }],
  }).lean();
}

/**
 * Tập loại trừ dùng chung cho mọi nhánh: Flash Sale + Limited + Sale.
 * Hàng mang các tag này thì discount do hệ khác quản lý, vòng đời không đụng tới.
 */
async function findExcludedIds(): Promise<Set<string>> {
  const fsIds = await FlashSaleService.getActiveFlashSaleProductIds().catch(() => [] as any[]);
  const [limitedTag, saleTags] = await Promise.all([
    Tag.findOne(LIMITED_TAG_QUERY).lean().catch(() => null),
    Tag.find({
      status: 'active',
      $or: [{ slug: /^sale$/i }, { slug: /^giam-gia$/i }, { slug: /^flash-sale$/i }],
    }).select('_id').lean().catch(() => []),
  ]);
  const tagIds = [
    ...(limitedTag ? [limitedTag._id] : []),
    ...saleTags.map((t: any) => t._id),
  ];
  let linkedIds: any[] = [];
  if (tagIds.length > 0) {
    const links = await ProductTag.find({ tagId: { $in: tagIds } }).select('productId').lean().catch(() => []);
    linkedIds = links.map(l => l.productId);
  }
  return new Set([...fsIds, ...linkedIds].map((id: any) => id.toString()));
}

/** Tập sản phẩm đủ điều kiện hưởng discount hệ thống = active + dưới 31 ngày + đang mang Tag New. */
async function findEligibleIds(newTagId: any): Promise<mongoose.Types.ObjectId[]> {
  const cutoff = new Date(Date.now() - AUTO_LIFECYCLE_DAYS * 24 * 60 * 60 * 1000);
  const recent = await Product.find({ status: 'active', createdAt: { $gte: cutoff } })
    .select('_id')
    .lean();
  if (recent.length === 0) return [];
  const links = await ProductTag.find({
    tagId: newTagId,
    productId: { $in: recent.map(p => p._id) },
  }).select('productId').lean();
  const linked = new Set(links.map(l => l.productId.toString()));
  return recent.map(p => p._id).filter(id => linked.has(id.toString()));
}

export class DiscountLifecycleService {
  private static lastRun = 0;

  /** Chạy định kỳ (throttle 10 phút). Trả null khi bị throttle. */
  static async syncAutoDiscounts(): Promise<DiscountCycleResult | null> {
    const now = Date.now();
    if (now - this.lastRun < THROTTLE_MS) return null;
    this.lastRun = now;
    return this.runCycle(false);
  }

  /** Xem trước không ghi — dùng cho script backfill dry-run. */
  static async preview(): Promise<DiscountPreview> {
    return this.runCycle(true) as Promise<DiscountPreview>;
  }

  /**
   * Một vòng đời đầy đủ:
   * 1. New: hàng đủ điều kiện + chưa có giảm giá + không Flash/Limited/Sale -> 5% + cờ.
   * 2. Limited: hàng Limited + chưa có giảm giá + không Flash/New -> mức khan hiếm 0-5% + cờ.
   *    Hết hàng giữ nguyên, khuyến mãi khác bỏ qua vĩnh viễn.
   * 3. Standard: hàng Standard + tồn kho + tuổi + sức bán -> mức % theo công thức, trần 15%.
   *    Hết hàng giữ nguyên, khuyến mãi khác bỏ qua vĩnh viễn, bỏ qua hàng dính New/Flash/Limited/Sale.
   * 4. Thu hồi gom mối: hàng mang cờ hệ thống mà không còn luật nào quản lý -> 0 + gỡ cờ
   *    (vượt trần thì chỉ gỡ cờ, giữ nguyên số).
   */
  static async runCycle(dryRun: boolean): Promise<DiscountCycleResult & { sampleAssign: string[]; sampleReclaim: string[]; sampleStandard: string[]; sampleLimited: string[] }> {
    const result: DiscountCycleResult & { sampleAssign: string[]; sampleReclaim: string[]; sampleStandard: string[]; sampleLimited: string[] } = {
      ...EMPTY_RESULT,
      standardLevels: {},
      limitedLevels: {},
      sampleAssign: [],
      sampleReclaim: [],
      sampleStandard: [],
      sampleLimited: [],
    };

    const newTag = await findNewTag();
    const excluded = await findExcludedIds();
    // Tập sản phẩm đang được một luật quản lý — dùng cho thu hồi gom mối cuối vòng.
    const managedIds = new Set<string>();

    // ── 1. New ──
    if (newTag) {
      const eligibleIds = await findEligibleIds(newTag._id);
      for (const id of eligibleIds) managedIds.add(id.toString());
      const assignCandidates = eligibleIds.filter(id => !excluded.has(id.toString()));
      result.skippedFlashSaleOrLimited = eligibleIds.length - assignCandidates.length;
      if (assignCandidates.length > 0) {
        const noDiscountFilter = {
          _id: { $in: assignCandidates },
          $or: [{ discountPercentage: 0 }, { discountPercentage: { $exists: false } }],
        };
        const needyCount = await Product.countDocuments(noDiscountFilter);
        const withDiscountCount = assignCandidates.length - needyCount;
        result.skippedHasDiscount = Math.max(0, withDiscountCount);
        if (!dryRun && needyCount > 0) {
          const res = await Product.updateMany(noDiscountFilter, {
            $set: { discountPercentage: NEW_AUTO_DISCOUNT_PERCENT, autoDiscount: true },
          });
          result.assigned = res.modifiedCount ?? needyCount;
        } else {
          result.assigned = needyCount;
        }
        if (dryRun) {
          const sample = await Product.find(noDiscountFilter).select('_id name').limit(10).lean().catch(() => []);
          result.sampleAssign = sample.map((p: any) => `${p._id.toString()}${p.name ? ` (${p.name})` : ''}`);
        }
      }
    }

    // ── 2. Limited: khan hiếm 0-5% ──
    const limitedTag = await Tag.findOne(LIMITED_TAG_QUERY).lean().catch(() => null);
    if (limitedTag) {
      const limLinks = await ProductTag.find({ tagId: limitedTag._id }).select('productId').lean().catch(() => []);
      if (limLinks.length > 0) {
        const limIds = limLinks.map(l => l.productId);
        const limProducts = await Product.find({ _id: { $in: limIds }, status: 'active' })
          .select('_id discountPercentage autoDiscount')
          .lean();
        const newLinkedAll = newTag
          ? await ProductTag.find({ tagId: newTag._id }).select('productId').lean().catch(() => [])
          : [];
        const newSet = new Set(newLinkedAll.map(l => l.productId.toString()));
        // Nhánh Limited loại trừ Flash Sale + New (KHÔNG loại link Limited của chính mình).
        const limFlashIds = new Set(
          (await FlashSaleService.getActiveFlashSaleProductIds().catch(() => [])).map((id: any) => id.toString())
        );
        const inScope = limProducts.filter(
          (p: any) => !newSet.has(p._id.toString()) && !limFlashIds.has(p._id.toString())
        );
        result.skippedLimitedExcluded = limProducts.length - inScope.length;
        for (const p of inScope) managedIds.add((p as any)._id.toString());
        for (const p of inScope) managedIds.add((p as any)._id.toString());

        // Tổng tồn kho từng sản phẩm từ bảng biến thể
        const limStockRows = await ProductVariant.aggregate([
          { $match: { productId: { $in: limIds } } },
          { $group: { _id: '$productId', total: { $sum: { $ifNull: ['$quantityInStock', 0] } } } },
        ]).catch(() => []);
        const limStockMap = new Map<string, number>(
          limStockRows.map((r: any) => [r._id.toString(), r.total || 0])
        );

        const limWrites = new Map<number, any[]>();
        for (const p of inScope) {
          const pid = (p as any)._id.toString();
          const stock = limStockMap.has(pid) ? limStockMap.get(pid)! : ((p as any).quantityInStock ?? 0);
          if (stock <= 0) { result.skippedLimitedOOS++; continue; } // hết hàng: giữ nguyên
          const current = (p as any).discountPercentage ?? 0;
          const flagged = !!(p as any).autoDiscount;
          if (current > 0 && !flagged) { result.skippedLimitedPromo++; continue; } // khuyến mãi khác: bỏ qua
          const level = computeLimitedDiscount(stock);
          if (level === current) continue; // đã đúng mức, khỏi ghi
          if (!limWrites.has(level)) limWrites.set(level, []);
          limWrites.get(level)!.push((p as any)._id);
          if (dryRun && result.sampleLimited.length < 10) {
            result.sampleLimited.push(`${pid} -> ${level}%`);
          }
        }

        if (!dryRun) {
          for (const [level, ids] of limWrites) {
            const res = await Product.updateMany(
              { _id: { $in: ids } },
              { $set: { discountPercentage: level, autoDiscount: true } }
            );
            const n = res.modifiedCount ?? ids.length;
            result.limitedAssigned += n;
            result.limitedLevels[String(level)] = (result.limitedLevels[String(level)] || 0) + ids.length;
          }
        } else {
          for (const [level, ids] of limWrites) {
            result.limitedLevels[String(level)] = ids.length;
          }
          result.limitedAssigned = [...limWrites.values()].reduce((n, ids) => n + ids.length, 0);
        }
      }
    }

    // ── 3. Standard: tồn kho + tuổi + sức bán, trần 15% ──
    const standardTag = await Tag.findOne({
      status: 'active',
      $or: [{ slug: /^standard$/i }, { name: /^tiêu chuẩn$/i }],
    }).lean().catch(() => null);
    if (standardTag) {
      const stdLinks = await ProductTag.find({ tagId: standardTag._id }).select('productId').lean().catch(() => []);
      if (stdLinks.length > 0) {
        const stdIds = stdLinks.map(l => l.productId);
        const newLinkedAll = newTag
          ? await ProductTag.find({ tagId: newTag._id }).select('productId').lean().catch(() => [])
          : [];
        const newSet = new Set(newLinkedAll.map(l => l.productId.toString()));
        const stdProducts = await Product.find({ _id: { $in: stdIds }, status: 'active' })
          .select('_id createdAt soldCount discountPercentage autoDiscount')
          .lean();
        const inScope = stdProducts.filter(
          (p: any) => !newSet.has(p._id.toString()) && !excluded.has(p._id.toString())
        );
        result.skippedStandardExcluded = stdProducts.length - inScope.length;
        for (const p of inScope) managedIds.add((p as any)._id.toString());

        // Tổng tồn kho từng sản phẩm từ bảng biến thể
        const stockRows = await ProductVariant.aggregate([
          { $match: { productId: { $in: stdIds } } },
          { $group: { _id: '$productId', total: { $sum: { $ifNull: ['$quantityInStock', 0] } } } },
        ]).catch(() => []);
        const stockMap = new Map<string, number>(
          stockRows.map((r: any) => [r._id.toString(), r.total || 0])
        );

        const nowMs = Date.now();
        const writes = new Map<number, any[]>();
        for (const p of inScope) {
          const pid = (p as any)._id.toString();
          const stock = stockMap.has(pid) ? stockMap.get(pid)! : ((p as any).quantityInStock ?? 0);
          if (stock <= 0) { result.skippedStandardOOS++; continue; } // hết hàng: giữ nguyên
          const current = (p as any).discountPercentage ?? 0;
          const flagged = !!(p as any).autoDiscount;
          if (current > 0 && !flagged) { result.skippedStandardPromo++; continue; } // khuyến mãi khác: bỏ qua
          const ageDays = Math.floor((nowMs - new Date((p as any).createdAt || nowMs).getTime()) / 86400000);
          const level = computeStandardDiscount({ stock, ageDays, soldCount: (p as any).soldCount || 0 });
          if (level === current) continue; // đã đúng mức, khỏi ghi
          if (!writes.has(level)) writes.set(level, []);
          writes.get(level)!.push((p as any)._id);
          if (dryRun && result.sampleStandard.length < 10) {
            result.sampleStandard.push(`${pid} -> ${level}%`);
          }
        }

        if (!dryRun) {
          for (const [level, ids] of writes) {
            const res = await Product.updateMany(
              { _id: { $in: ids } },
              { $set: { discountPercentage: level, autoDiscount: true } }
            );
            const n = res.modifiedCount ?? ids.length;
            result.standardAssigned += n;
            result.standardLevels[String(level)] = (result.standardLevels[String(level)] || 0) + ids.length;
          }
        } else {
          for (const [level, ids] of writes) {
            result.standardLevels[String(level)] = ids.length;
          }
          result.standardAssigned = [...writes.values()].reduce((n, ids) => n + ids.length, 0);
        }
      }
    }

    // ── 4. Thu hồi gom mối: hàng mang cờ hệ thống mà không còn luật nào quản lý
    // -> 0 + gỡ cờ (vượt trần thì chỉ gỡ cờ, giữ nguyên số).
    const flagged = await Product.find({ status: 'active', autoDiscount: true })
      .select('_id discountPercentage')
      .lean();
    const stale = flagged.filter((p: any) => !managedIds.has(p._id.toString()));
    if (stale.length > 0) {
      const zeroable = stale.filter((p: any) => !((p as any).discountPercentage > STANDARD_MAX_DISCOUNT));
      const protectedOnes = stale.filter((p: any) => (p as any).discountPercentage > STANDARD_MAX_DISCOUNT);
      result.sampleReclaim = zeroable.slice(0, 10).map((p: any) => p._id.toString());
      if (!dryRun) {
        if (zeroable.length > 0) {
          const res = await Product.updateMany(
            { _id: { $in: zeroable.map((p: any) => p._id) } },
            { $set: { discountPercentage: 0, autoDiscount: false } }
          );
          result.reclaimed = res.modifiedCount ?? zeroable.length;
        }
        if (protectedOnes.length > 0) {
          // Vượt trần (khuyến mãi thật xuất hiện sau đó): chỉ gỡ cờ, giữ nguyên số.
          await Product.updateMany(
            { _id: { $in: protectedOnes.map((p: any) => p._id) } },
            { $set: { autoDiscount: false } }
          );
          result.reclaimedFlagOnly = protectedOnes.length;
        }
      } else {
        result.reclaimed = zeroable.length;
        result.reclaimedFlagOnly = protectedOnes.length;
      }
    }

    if (!dryRun && (result.assigned > 0 || result.reclaimed > 0 || result.standardAssigned > 0 || result.limitedAssigned > 0)) {
      await this.clearDiscountCaches();
    }
    return result;
  }

  /** Xóa cache các section đọc discount. */
  static async clearDiscountCaches(): Promise<number> {
    // Quét theo prefix, không gắn số version vào pattern: key thật lên version liên tục
    // (`products:trending:v11` → `v12`) nên pattern cũ âm thầm không xoá gì cả, giá giảm
    // vẫn phục vụ từ cache sai cả sau khi sync đã đổi.
    const patterns = [
      'homepage:*',
      'products:new:*',
      'products:limited:*',
      'products:trending:*',
      'products:sale:*',
      'products:public:*',
      'products:seasonal:*',
      'products:suggest:*',
      'product:detail:*',
      'graphql:*',
    ];
    let total = 0;
    for (const pattern of patterns) {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        if (keys.length > 0) {
          await redis.del(...keys);
          total += keys.length;
        }
      } while (cursor !== '0');
    }
    // Trang chủ còn một lớp cache in-memory riêng trong từng process — sạch redis chưa
    // chắc UI đã đổi ngay.
    try {
      const { invalidateHomepageCache } = await import('../../graphql/schema.ts');
      invalidateHomepageCache();
    } catch (_) {}
    return total;
  }
}
