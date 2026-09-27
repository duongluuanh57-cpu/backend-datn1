import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

const oid = () => new mongoose.Types.ObjectId();

const LIMITED_TAG_ID = oid();
const NEW_TAG_ID = oid();
const STANDARD_TAG_ID = oid();

const store = vi.hoisted(() => ({
  limitedQualifying: [] as any[],
  limitedHolders: [] as any[],
  recentProducts: [] as any[],
  aiResponse: '',
}));

// Giữ nguyên LIMITED_TAG_QUERY / LIMITED_TAG_SLUGS thật, chỉ thay hàm luật đọc DB.
vi.mock('../../../services/product/tagRules.ts', async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  findLimitedProductIds: vi.fn(async () => store.limitedQualifying),
  newCutoffDate: vi.fn(() => new Date(0)),
}));

vi.mock('../../../models/Product.ts', () => ({
  Product: {
    // $gte = nhóm còn hạn New, $lt = nhóm quá hạn. Trả hết cho 2 truy vấn thì vòng
    // gỡ-qua-hạn sẽ ăn luôn hàng mới và ngấm vào kết quả.
    find: vi.fn((q: any) => ({
      select: () => ({ lean: async () => (q?.createdAt?.$gte ? store.recentProducts : []) }),
    })),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  },
}));

vi.mock('../../../models/Tag.ts', () => ({
  Tag: {
    findOne: vi.fn((q: any) => ({
      lean: async () => {
        const sig = (q?.$or ?? []).map((c: any) => `${c.slug} ${c.name}`).join(' ');
        if (sig.includes('limited')) return { _id: LIMITED_TAG_ID, slug: 'limited', name: 'Limited' };
        if (sig.includes('standard')) return { _id: STANDARD_TAG_ID, slug: 'standard', name: 'Tiêu chuẩn' };
        if (sig.includes('new')) return { _id: NEW_TAG_ID, slug: 'new', name: 'Sản phẩm mới' };
        return null;
      },
    })),
    find: vi.fn(() => ({ lean: async () => [] })),
  },
}));

vi.mock('../../../models/ProductTag.ts', () => ({
  ProductTag: {
    find: vi.fn(() => ({ select: () => ({ lean: async () => [] }), lean: async () => [] })),
    exists: vi.fn().mockResolvedValue(false),
    create: vi.fn().mockResolvedValue({}),
    distinct: vi.fn(async () => store.limitedHolders),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    insertMany: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../../models/FlashSale.ts', () => ({ FlashSale: {} }));
vi.mock('../../../models/ProductVariant.ts', () => ({
  ProductVariant: { aggregate: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../../services/FlashSaleService.ts', () => ({
  FlashSaleService: { getActiveFlashSaleProductIds: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../../services/SearchService.ts', () => ({
  SearchService: { hybridSearch: vi.fn().mockResolvedValue({ products: [], brands: [] }) },
}));
vi.mock('../../../services/AIService.ts', () => ({
  AIService: { generateResponse: vi.fn(async () => store.aiResponse) },
}));

import { ProductQueryService } from '../../../services/product/productQueryService.ts';
import { ProductTag } from '../../../models/ProductTag.ts';
import { Product } from '../../../models/Product.ts';
import { generateProduct } from '../../../controllers/aiCatalog/generateProductController.ts';
import { TAG_RULES } from '../../../services/product/tagRules.ts';

function fakeReply() {
  const reply: any = {
    payload: null,
    send(body: any) { reply.payload = body; return reply; },
    status() { return reply; },
  };
  return reply;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.limitedQualifying = [];
  store.limitedHolders = [];
  store.recentProducts = [];
  store.aiResponse = '';
  (ProductQueryService as any).lastSyncLimitedTime = 0;
  (ProductQueryService as any).lastSyncNewArrivalTime = 0;
});

describe('syncLimitedTags với link do người gán', () => {
  it('chỉ gỡ link auto, giữ link manual ngoài luật tồn kho', async () => {
    const qualifying = oid();
    store.limitedQualifying = [qualifying];

    await ProductQueryService.syncLimitedTags();

    const del = (ProductTag.deleteMany as any).mock.calls.find(
      (c: any) => c[0]?.tagId?.toString() === LIMITED_TAG_ID.toString()
    );
    expect(del).toBeDefined();
    // Link cũ tạo trước khi có cột source vẫn phải gỡ được => lọc $ne manual.
    expect(del[0].source).toEqual({ $ne: 'manual' });
    // $nin: hàng đang đạt luật tồn kho thì nằm ngoài danh sách bị gỡ.
    expect(del[0].productId.$nin.map(String)).toEqual([qualifying.toString()]);
  });

  it('link auto mới gán luôn mang source=auto để lần sau còn gỡ được', async () => {
    const qualifying = oid();
    store.limitedQualifying = [qualifying];

    await ProductQueryService.syncLimitedTags();

    const inserted = (ProductTag.insertMany as any).mock.calls[0][0];
    expect(inserted[0].source).toBe('auto');
  });

  it('sản phẩm giữ tag Limited (kể cả manual) bị gỡ New và isNewArrival = false', async () => {
    const manualHolder = oid();
    store.limitedQualifying = [];
    store.limitedHolders = [manualHolder];

    await ProductQueryService.syncLimitedTags();

    const newDelete = (ProductTag.deleteMany as any).mock.calls.find(
      (c: any) => c[0]?.tagId?.toString() === NEW_TAG_ID.toString()
    );
    expect(newDelete).toBeDefined();
    expect(newDelete[0].productId.$in.map(String)).toContain(manualHolder.toString());
    const offline = (Product.updateMany as any).mock.calls.find(
      (c: any) => c[1]?.$set?.isNewArrival === false
    );
    expect(offline[0]._id.$in.map(String)).toContain(manualHolder.toString());
  });
});

describe('syncNewArrivalTags n nhường hàng Limited', () => {
  it('không gán lại New cho sản phẩm đang mang Limited', async () => {
    const limitedProduct = { _id: oid() };
    const normalProduct = { _id: oid() };
    store.limitedHolders = [limitedProduct._id];
    store.recentProducts = [limitedProduct, normalProduct];

    await ProductQueryService.syncNewArrivalTags();

    // Chỉ nhìn link New: vòng gán Standard cho hàng quá hạn cũng dùng ProductTag.create.
    const createdIds = (ProductTag.create as any).mock.calls
      .filter((c: any) => c[0]?.tagId?.toString() === NEW_TAG_ID.toString())
      .map((c: any) => c[0].productId.toString());
    expect(createdIds).not.toContain(limitedProduct._id.toString());
    expect(createdIds).toContain(normalProduct._id.toString());
  });
});

describe('AI generate sản phẩm Limited', () => {
  async function runWith(variants: any[], tag: string) {
    store.aiResponse = JSON.stringify({ name: 'X', tag, variants });
    const reply = fakeReply();
    await generateProduct(
      { body: { name: 'Test EDP', availableTags: ['Limited'], availableBrands: [], availableCategories: [] } } as any,
      reply
    );
    return reply.payload?.data;
  }

  it('bóp tổng tồn kho bản limited về đúng trần của luật Limited', async () => {
    const data = await runWith(
      [
        { size: '10ml', price: 700000, quantityInStock: 25 },
        { size: '50ml', price: 2400000, quantityInStock: 20 },
        { size: '100ml', price: 3600000, quantityInStock: 15 },
      ],
      'Limited'
    );
    const total = data.variants.reduce((s: number, v: any) => s + v.quantityInStock, 0);
    expect(total).toBe(TAG_RULES.limitedMaxTotalStock);
  });

  it('bản thường không bị chạm tồn kho', async () => {
    const data = await runWith(
      [{ size: '100ml', price: 900000, quantityInStock: 300 }],
      ''
    );
    expect(data.variants[0].quantityInStock).toBe(300);
  });

  it('tồn kho trong trần thì giữ nguyên số AI ước lượng', async () => {
    const data = await runWith(
      [{ size: '100ml', price: 4500000, quantityInStock: 6 }],
      'Limited'
    );
    expect(data.variants[0].quantityInStock).toBe(6);
  });
});
