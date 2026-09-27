import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

const oid = () => new mongoose.Types.ObjectId();

const NEW_TAG_ID = oid();
const STANDARD_TAG_ID = oid();
const LIMITED_TAG_ID = oid();

vi.mock('../../../models/Product.ts', () => ({
  Product: {
    find: vi.fn(),
    findById: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  },
}));

vi.mock('../../../models/Tag.ts', () => ({
  Tag: { findOne: vi.fn(), find: vi.fn(() => ({ lean: async () => [] })) },
}));

vi.mock('../../../models/ProductTag.ts', () => ({
  ProductTag: {
    find: vi.fn(() => ({ lean: async () => [], select: () => ({ lean: async () => [] }) })),
    exists: vi.fn().mockResolvedValue(false),
    create: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    insertMany: vi.fn().mockResolvedValue([]),
    distinct: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../../models/Brand.ts', () => ({ Brand: {} }));
vi.mock('../../../models/Category.ts', () => ({ Category: { findOne: vi.fn().mockResolvedValue(null) } }));
vi.mock('../../../models/Review.ts', () => ({ Review: {} }));
vi.mock('../../../models/ProductImage.ts', () => ({ ProductImage: {} }));
vi.mock('../../../models/ProductVariant.ts', () => ({ ProductVariant: {} }));
vi.mock('../../../models/OrderItem.ts', () => ({ OrderItem: {} }));
vi.mock('../../../models/FlashSale.ts', () => ({ FlashSale: {} }));
vi.mock('../../../services/ImageService.ts', () => ({ ImageService: {} }));
vi.mock('../../../services/FuzzyMatchCache.ts', () => ({ FuzzyMatchCache: {} }));
vi.mock('../../../services/product/productHelpers.ts', () => ({
  resolveCategoryNames: vi.fn().mockReturnValue(''),
  parseSizes: vi.fn().mockReturnValue([]),
  slugify: vi.fn((s: string) => s),
}));
vi.mock('../../../services/product/productFormatterService.ts', () => ({
  formatMultipleProducts: vi.fn().mockResolvedValue([]),
  getDefaultVariant: vi.fn().mockReturnValue(null),
}));
vi.mock('../../../services/FlashSaleService.ts', () => ({
  FlashSaleService: { getActiveFlashSaleProductIds: vi.fn().mockResolvedValue([]) },
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

import { ProductQueryService } from '../../../services/product/productQueryService.ts';
import { ProductMutationService } from '../../../services/product/productMutationService.ts';
import { Product } from '../../../models/Product.ts';
import { Tag } from '../../../models/Tag.ts';
import { ProductTag } from '../../../models/ProductTag.ts';

const ALL_TAGS = [
  { _id: NEW_TAG_ID, slug: 'new', name: 'Sản phẩm mới' },
  { _id: STANDARD_TAG_ID, slug: 'standard', name: 'Tiêu chuẩn' },
  { _id: LIMITED_TAG_ID, slug: 'limited', name: 'Limited' },
];

function mockTagFindOne() {
  (Tag.findOne as any).mockImplementation((q: any) => ({
    lean: async () => {
      const sig = (q?.$or ?? []).map((c: any) => `${c.slug} ${c.name}`).join(' ');
      if (sig.includes('standard')) return ALL_TAGS[1];
      if (sig.includes('limited')) return ALL_TAGS[2];
      if (sig.includes('new')) return ALL_TAGS[0];
      return null;
    },
  }));
  (Tag.find as any).mockImplementation(() => ({ lean: async () => ALL_TAGS }));
}

beforeEach(() => {
  vi.clearAllMocks();
  (ProductQueryService as any).lastSyncNewArrivalTime = 0;
  mockTagFindOne();
});

describe('Luật loại trừ New / Standard', () => {
  it('job chiều gán: vừa gán New vừa gỡ Standard cùng nhóm', async () => {
    const p1 = { _id: oid() };
    (Product.find as any).mockImplementation((q: any) => ({
      select: () => ({
        lean: async () => (q?.createdAt?.$gte ? [p1] : []),
      }),
    }));
    (ProductTag.find as any).mockImplementation(() => ({
      lean: async () => [],
      select: () => ({ lean: async () => [] }),
    }));

    await ProductQueryService.syncNewArrivalTags();

    const stdDelete = (ProductTag.deleteMany as any).mock.calls.find(
      (c: any) => c[0]?.tagId?.toString?.() === STANDARD_TAG_ID.toString()
    );
    expect(stdDelete).toBeDefined();
    expect(stdDelete[0].productId.$in.map(String)).toContain(p1._id.toString());
    // Vẫn gán New như cũ
    expect(ProductTag.create).toHaveBeenCalled();
  });

  it('admin cập nhật tag New kèm Standard: Standard bị loại trước khi ghi', async () => {
    const pid = oid().toString();
    (Product.findById as any).mockResolvedValue({ _id: pid, name: 'X', brandId: oid() });
    (Product.findOneAndUpdate as any).mockResolvedValue({ _id: pid });

    await ProductMutationService.updateProduct(pid, { tag: 'New, Standard' });

    expect(ProductTag.deleteMany).toHaveBeenCalledWith({ productId: pid });
    const inserted = (ProductTag.insertMany as any).mock.calls[0][0];
    expect(inserted).toHaveLength(1);
    expect(inserted[0].tagId.toString()).toBe(NEW_TAG_ID.toString());
  });

  it('admin cập nhật tag Limited kèm Standard: giữ nguyên cả hai', async () => {
    const pid = oid().toString();
    (Product.findById as any).mockResolvedValue({ _id: pid, name: 'X', brandId: oid() });
    (Product.findOneAndUpdate as any).mockResolvedValue({ _id: pid });

    await ProductMutationService.updateProduct(pid, { tag: 'Limited, Standard' });

    const inserted = (ProductTag.insertMany as any).mock.calls[0][0];
    expect(inserted).toHaveLength(2);
  });
});
