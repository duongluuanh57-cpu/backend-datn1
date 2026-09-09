import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

const oid = () => new mongoose.Types.ObjectId();

vi.mock('../../../models/Product.ts', () => ({
  Product: {
    find: vi.fn(),
    countDocuments: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue([]),
    // Giả lập modifiedCount theo đúng ngữ nghĩa: gán 2 bản ghi thiếu, thu hồi 1, gỡ cờ 1
    updateMany: vi.fn(async (_filter: any, update: any) => {
      if (update?.$set?.discountPercentage === 5) return { modifiedCount: 2 };
      if (update?.$set?.discountPercentage === 0) return { modifiedCount: 1 };
      return { modifiedCount: 1 };
    }),
  },
}));

vi.mock('../../../models/ProductVariant.ts', () => ({
  ProductVariant: { aggregate: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../../models/Tag.ts', () => ({
  Tag: { findOne: vi.fn(), find: vi.fn() },
}));

vi.mock('../../../models/ProductTag.ts', () => ({
  ProductTag: {
    find: vi.fn(() => ({ select: () => ({ lean: async () => [] }) })),
    exists: vi.fn().mockResolvedValue(false),
    create: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
  },
}));

vi.mock('../../../config/redis.ts', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
    scan: vi.fn().mockResolvedValue(['0', []]),
  },
}));

vi.mock('../../../services/FlashSaleService.ts', () => ({
  FlashSaleService: { getActiveFlashSaleProductIds: vi.fn().mockResolvedValue([]) },
}));

import {
  DiscountLifecycleService,
  computeStandardDiscount,
  computeLimitedDiscount,
} from '../../../services/product/discountLifecycleService.ts';
import { Product } from '../../../models/Product.ts';
import { Tag } from '../../../models/Tag.ts';
import { ProductTag } from '../../../models/ProductTag.ts';
import { ProductVariant } from '../../../models/ProductVariant.ts';
import { FlashSaleService } from '../../../services/FlashSaleService.ts';
import { redis } from '../../../config/redis.ts';

const NEW_TAG_ID = oid();
const LIMITED_TAG_ID = oid();
const STANDARD_TAG_ID = oid();
const SALE_TAG_ID = oid();

interface Scenario {
  recent: any[];
  discounts: Record<string, number>;
  newLinked: string[];
  limitedLinked: string[];
  saleLinked: string[];
  standardLinked: string[];
  standardProducts: any[];
  limitedProducts: any[];
  stockRows: any[];
  flashIds: string[];
  flagged: any[];
}

function setupScenario(s: Scenario) {
  (Tag.findOne as any).mockImplementation((q: any) => ({
    lean: async () => {
      const sig = String(q?.$or?.[0]?.slug || '') + String(q?.$or?.[1]?.name || '');
      if (sig.includes('standard')) return { _id: STANDARD_TAG_ID, slug: 'standard' };
      if (sig.includes('new')) return { _id: NEW_TAG_ID, slug: 'new' };
      return { _id: LIMITED_TAG_ID, slug: 'limited' };
    },
  }));
  (Tag.find as any).mockImplementation(() => ({
    select: () => ({ lean: async () => [{ _id: SALE_TAG_ID, slug: 'sale' }] }),
  }));

  const allDiscounts: Record<string, number> = { ...s.discounts };
  for (const p of [...s.standardProducts, ...(s.limitedProducts || [])]) {
    allDiscounts[p._id.toString()] = p.discountPercentage ?? 0;
  }

  (Product.find as any).mockImplementation((q: any) => ({
    select: () => ({
      limit: () => ({
        lean: async () => s.recent.filter(p => (s.discounts[p._id.toString()] ?? 0) === 0).slice(0, 10),
      }),
      lean: async () => {
        if (q?.autoDiscount) return s.flagged;
        if (q?.createdAt?.$gte) return s.recent;
        if (q?._id?.$in && q?.status === 'active') {
          const pool = [...s.standardProducts, ...(s.limitedProducts || [])];
          const set = new Set((q._id.$in as any[]).map(String));
          return pool.filter(p => set.has(p._id.toString()));
        }
        return [];
      },
    }),
  }));

  (Product.countDocuments as any).mockImplementation((q: any) => {
    const ids: any[] = q?._id?.$in || [];
    return ids.filter(id => (s.discounts[id.toString()] ?? 0) === 0).length;
  });

  (Product.updateMany as any).mockImplementation(async (filter: any) => {
    const ids: any[] = filter?._id?.$in || [];
    if (filter?.$or) {
      // Nhánh New: DB tự lọc discount 0 — mô phỏng đúng ngữ nghĩa
      return { modifiedCount: ids.filter(id => (allDiscounts[id.toString()] ?? 0) === 0).length };
    }
    return { modifiedCount: ids.length };
  });

  (ProductTag.find as any).mockImplementation((q: any) => {
    let rows: any[];
    if (q?.tagId?.$in) {
      // findExcludedIds: gộp Limited + Sale
      rows = [
        ...s.limitedLinked.map(productId => ({ productId, tagId: LIMITED_TAG_ID })),
        ...s.saleLinked.map(productId => ({ productId, tagId: SALE_TAG_ID })),
      ];
    } else {
      const tagId = q?.tagId?.toString?.();
      rows =
        tagId === NEW_TAG_ID.toString()
          ? s.newLinked.map(productId => ({ productId, tagId: NEW_TAG_ID }))
          : tagId === STANDARD_TAG_ID.toString()
            ? s.standardLinked.map(productId => ({ productId, tagId: STANDARD_TAG_ID }))
            : s.limitedLinked.map(productId => ({ productId, tagId: LIMITED_TAG_ID }));
    }
    return { select: () => ({ lean: async () => rows }) };
  });

  (ProductVariant.aggregate as any).mockResolvedValue(s.stockRows);

  (FlashSaleService.getActiveFlashSaleProductIds as any).mockResolvedValue(s.flashIds);
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);

function baseScenario(): Scenario {
  const r1 = { _id: oid() };
  const r2 = { _id: oid() };
  const rSale = { _id: oid() };
  const rFlash = { _id: oid() };
  const rLimited = { _id: oid() };
  const fOld = { _id: oid(), discountPercentage: 5 };
  const fPromo = { _id: oid(), discountPercentage: 20 };
  const fKeep = { _id: oid(), discountPercentage: 5 };
  const recent = [r1, r2, rSale, rFlash, rLimited, fKeep];

  // Hàng Standard: s1 tồn cao + già + bán chậm -> 14; s2 trẻ bán tốt -> 1;
  // s3 hết hàng -> giữ; s4 khuyến mãi thật -> giữ; sS dính Sale loại
  const s1 = { _id: oid(), createdAt: daysAgo(200), soldCount: 5, discountPercentage: 0 };
  const s2 = { _id: oid(), createdAt: daysAgo(40), soldCount: 50, discountPercentage: 0 };
  const s3 = { _id: oid(), createdAt: daysAgo(100), soldCount: 10, discountPercentage: 0 };
  const s4 = { _id: oid(), createdAt: daysAgo(100), soldCount: 10, discountPercentage: 10, autoDiscount: false };
  const sS = { _id: oid(), createdAt: daysAgo(100), soldCount: 5, discountPercentage: 0 };
  const standardProducts = [s1, s2, s3, s4, sS];
  // Hàng Limited: L1 tồn 40 -> 5; L2 tồn 2 -> 0 giữ; L3 có khuyến mãi -> giữ;
  // L4 dính Flash loại; L5 hết hàng -> giữ; rLimited dính New -> loại khỏi nhánh Limited
  const L1 = { _id: oid(), discountPercentage: 0 };
  const L2 = { _id: oid(), discountPercentage: 0 };
  const L3 = { _id: oid(), discountPercentage: 3, autoDiscount: false };
  const L4 = { _id: oid(), discountPercentage: 0 };
  const L5 = { _id: oid(), discountPercentage: 0 };
  const rLim = { _id: rLimited._id };
  const limitedProducts = [rLim, L1, L2, L3, L4, L5];
  return {
    recent,
    discounts: {
      [r1._id.toString()]: 0,
      [r2._id.toString()]: 0,
      [rSale._id.toString()]: 20,
      [rFlash._id.toString()]: 0,
      [rLimited._id.toString()]: 0,
      [fKeep._id.toString()]: 5,
    },
    newLinked: recent.map(p => p._id.toString()),
    limitedLinked: [rLimited._id.toString(), L1._id.toString(), L2._id.toString(), L3._id.toString(), L4._id.toString(), L5._id.toString()],
    saleLinked: [sS._id.toString()],
    standardLinked: [...standardProducts.map(p => (p._id as any).toString()), L1._id.toString(), L2._id.toString(), L3._id.toString(), L4._id.toString(), L5._id.toString()],
    standardProducts,
    limitedProducts,
    stockRows: [
      { _id: s1._id, total: 120 },
      { _id: s2._id, total: 10 },
      { _id: s4._id, total: 60 },
      { _id: sS._id, total: 100 },
      { _id: L1._id, total: 40 },
      { _id: L2._id, total: 2 },
      { _id: L3._id, total: 30 },
      { _id: L4._id, total: 50 },
    ],
    flashIds: [rFlash._id.toString(), L4._id.toString()],
    flagged: [fOld, fPromo, fKeep],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (DiscountLifecycleService as any).lastRun = 0;
});

describe('DiscountLifecycleService — mô hình discount trung tâm theo Tag', () => {
  it('preview: đếm đúng gán / bỏ qua / thu hồi mà không ghi gì', async () => {
    setupScenario(baseScenario());

    const preview = await DiscountLifecycleService.preview();

    // Gán: r1, r2 (New + chưa giảm giá); bỏ qua rSale + fKeep (đã có số), rFlash + rLimited (loại trừ)
    expect(preview.assigned).toBe(2);
    expect(preview.skippedHasDiscount).toBe(2);
    expect(preview.skippedFlashSaleOrLimited).toBe(2);
    // Thu hồi: fOld (5 -> 0); fPromo chỉ gỡ cờ; fKeep vẫn đủ điều kiện nên giữ
    expect(preview.reclaimed).toBe(1);
    expect(preview.reclaimedFlagOnly).toBe(1);
    expect(preview.sampleAssign.length).toBeGreaterThan(0);
    // Standard: s1 -> 14, s2 -> 1; s3 hết hàng giữ; s4 khuyến mãi giữ;
    // sS dính Sale loại, L1-L5 dính Limited loại (giữ discount của tag đó)
    expect(preview.standardAssigned).toBe(2);
    expect(preview.standardLevels).toEqual({ '14': 1, '1': 1 });
    expect(preview.skippedStandardOOS).toBe(1);
    expect(preview.skippedStandardPromo).toBe(1);
    expect(preview.skippedStandardExcluded).toBe(6);
    // Limited khan hiếm: L1 tồn 40 -> 5; L2 tồn 2 -> 0 giữ; L3 khuyến mãi giữ;
    // L4 dính Flash loại, rLimited dính New loại, L5 hết hàng -> giữ
    expect(preview.limitedAssigned).toBe(1);
    expect(preview.limitedLevels).toEqual({ '5': 1 });
    expect(preview.skippedLimitedOOS).toBe(1);
    expect(preview.skippedLimitedPromo).toBe(1);
    expect(preview.skippedLimitedExcluded).toBe(2);
    expect(Product.updateMany).not.toHaveBeenCalled();
  });

  it('runCycle: ghi 5% + thu hồi + xóa cache', async () => {
    setupScenario(baseScenario());
    (redis.scan as any).mockResolvedValueOnce(['0', ['homepage:v18']]);

    const result = await DiscountLifecycleService.runCycle(false);

    expect(result.assigned).toBe(2);
    expect(result.reclaimed).toBe(1);
    expect(result.reclaimedFlagOnly).toBe(1);

    const assignCall = (Product.updateMany as any).mock.calls.find(
      (c: any) => c[1]?.$set?.discountPercentage === 5
    );
    expect(assignCall).toBeDefined();
    expect(assignCall[1].$set).toMatchObject({ discountPercentage: 5, autoDiscount: true });

    const reclaimCall = (Product.updateMany as any).mock.calls.find(
      (c: any) => c[1]?.$set?.discountPercentage === 0
    );
    expect(reclaimCall).toBeDefined();
    expect(reclaimCall[1].$set).toMatchObject({ discountPercentage: 0, autoDiscount: false });

    // Nhánh Standard ghi đúng mức từng nhóm
    const calls = (Product.updateMany as any).mock.calls;
    const std14 = calls.find((c: any) => c[1]?.$set?.discountPercentage === 14);
    const std1 = calls.find((c: any) => c[1]?.$set?.discountPercentage === 1);
    expect(std14).toBeDefined();
    expect(std1).toBeDefined();
    expect(std14[1].$set).toMatchObject({ autoDiscount: true });
    expect(result.standardAssigned).toBe(2);
    expect(result.standardLevels).toEqual({ '14': 1, '1': 1 });
    // Nhánh New (có $or) và nhánh Limited (không $or) đều ghi 5% nhưng tách bạch
    const newAssign = calls.find((c: any) => c[1]?.$set?.discountPercentage === 5 && c[0]?.$or);
    const limWrite = calls.find((c: any) => c[1]?.$set?.discountPercentage === 5 && !c[0]?.$or);
    expect(newAssign).toBeDefined();
    expect(limWrite).toBeDefined();
    expect(limWrite[0]._id.$in.map(String)).toEqual([expect.any(String)]);
    expect(result.limitedAssigned).toBe(1);
    expect(result.limitedLevels).toEqual({ '5': 1 });

    // Có ghi là xóa cache section
    expect(redis.del).toHaveBeenCalled();
  });

  it('computeLimitedDiscount: khan hiếm theo tồn kho, trần 5%', () => {
    expect(computeLimitedDiscount(0)).toBe(0);
    expect(computeLimitedDiscount(2)).toBe(0);
    expect(computeLimitedDiscount(3)).toBe(0);
    expect(computeLimitedDiscount(4)).toBe(2);
    expect(computeLimitedDiscount(10)).toBe(2);
    expect(computeLimitedDiscount(11)).toBe(3);
    expect(computeLimitedDiscount(30)).toBe(3);
    expect(computeLimitedDiscount(31)).toBe(5);
    expect(computeLimitedDiscount(500)).toBe(5);
  });

  it('computeStandardDiscount: mốc tồn, tuổi, sức bán và trần 15%', () => {
    // Tồn cao + già + bán chậm: 6 + 5 + 3 = 14
    expect(computeStandardDiscount({ stock: 120, ageDays: 200, soldCount: 5 })).toBe(14);
    // Trẻ + bán tốt: 0 + 1 + 0 = 1
    expect(computeStandardDiscount({ stock: 10, ageDays: 40, soldCount: 50 })).toBe(1);
    // Vượt trần: 6 + 5 + 5 = 16 -> chặn 15
    expect(computeStandardDiscount({ stock: 200, ageDays: 300, soldCount: 0 })).toBe(15);
    // Hàng chết (0 lượt bán sau 60 ngày): 2 + 3 + 5 = 10
    expect(computeStandardDiscount({ stock: 30, ageDays: 100, soldCount: 0 })).toBe(10);
    // Không tồn không tuổi không bán: 0
    expect(computeStandardDiscount({ stock: 5, ageDays: 10, soldCount: 50 })).toBe(0);
  });

  it('syncAutoDiscounts throttle: lần 2 trong 10 phút trả null', async () => {
    (Tag.findOne as any).mockImplementation(() => ({ lean: async () => null }));

    const first = await DiscountLifecycleService.syncAutoDiscounts();
    const second = await DiscountLifecycleService.syncAutoDiscounts();

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('không có Tag New thì bỏ nhánh New nhưng các nhánh khác vẫn chạy', async () => {
    (Tag.findOne as any).mockImplementation(() => ({ lean: async () => null }));

    const result = await DiscountLifecycleService.runCycle(false);

    // Nhánh New nghỉ (mock sót lại từ scenario trước không còn New link để tính)
    expect(result.assigned).toBe(0);
    // Thu hồi gom mối vẫn dọn cờ mồ côi: fOld + fKeep về 0, fPromo chỉ gỡ cờ
    expect(result.reclaimed).toBe(2);
    expect(result.reclaimedFlagOnly).toBe(1);
  });
});
