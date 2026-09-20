import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

const oid = () => new mongoose.Types.ObjectId();

// Product vừa là constructor (new Product(...)) vừa có static methods —
// vi.hoisted để biến sống sót qua việc vi.mock được hoisted lên đầu file.
const { ProductMock } = vi.hoisted(() => {
  const ProductMock: any = vi.fn().mockImplementation(function (this: any, data: any) {
    Object.assign(this, data || {});
    this.save = async () => ({ _id: `mock-id-${Math.random().toString(16).slice(2)}`, ...data });
  });
  ProductMock.findById = vi.fn();
  ProductMock.findOne = vi.fn();
  ProductMock.findOneAndUpdate = vi.fn();
  ProductMock.updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  ProductMock.updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  ProductMock.deleteOne = vi.fn();
  ProductMock.deleteMany = vi.fn();
  ProductMock.find = vi.fn(() => ({ lean: async () => [] }));
  ProductMock.create = vi.fn();
  return { ProductMock };
});

vi.mock('../../../models/Product.ts', () => ({ Product: ProductMock }));
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
  },
}));
vi.mock('../../../models/Brand.ts', () => ({ Brand: { findOne: vi.fn() } }));
vi.mock('../../../models/Category.ts', () => ({ Category: { findOne: vi.fn() } }));
vi.mock('../../../models/Review.ts', () => ({ Review: {}, ASPECT_OPTIONS: {} }));
vi.mock('../../../models/ProductImage.ts', () => ({
  ProductImage: {
    find: vi.fn(() => ({ lean: async () => [] })),
    deleteMany: vi.fn(),
    insertMany: vi.fn(),
  },
}));
vi.mock('../../../models/ProductVariant.ts', () => ({
  ProductVariant: {
    deleteMany: vi.fn(),
    insertMany: vi.fn().mockResolvedValue([{ _id: new mongoose.Types.ObjectId() }]),
    find: vi.fn(() => ({ lean: async () => [] })),
    distinct: vi.fn(),
    aggregate: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('../../../models/OrderItem.ts', () => ({ OrderItem: {} }));
vi.mock('../../../models/FlashSale.ts', () => ({ FlashSale: {} }));
vi.mock('../../../services/ImageService.ts', () => ({ ImageService: {} }));
vi.mock('../../../services/FuzzyMatchCache.ts', () => ({ FuzzyMatchCache: {} }));
vi.mock('../../../services/product/productHelpers.ts', () => ({
  resolveCategoryNames: vi.fn().mockReturnValue(''),
  parseSizes: vi.fn().mockReturnValue([]),
  slugify: vi.fn((s: string) => s.toLowerCase().replace(/\s+/g, '-')),
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

vi.mock('../../../graphql/schema.ts', () => ({ invalidateHomepageCache: vi.fn() }));

import { ProductMutationService, clearProductCache } from '../../../services/product/productMutationService.ts';
import { ProductVariant } from '../../../models/ProductVariant.ts';
import { ProductTag } from '../../../models/ProductTag.ts';
import { ProductImage } from '../../../models/ProductImage.ts';
import { Brand } from '../../../models/Brand.ts';
import { redis } from '../../../config/redis.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('updateProduct — discount (fix #2)', () => {
  it('nhận discountPercentage từ admin, gỡ cờ autoDiscount', async () => {
    const pid = oid().toString();
    (ProductMock.findById as any).mockResolvedValue({ _id: pid, name: 'X', brandId: oid() });
    (ProductMock.findOneAndUpdate as any).mockResolvedValue({ _id: pid });

    await ProductMutationService.updateProduct(pid, { discountPercentage: 20 });

    const setArg = (ProductMock.findOneAndUpdate as any).mock.calls[0][1].$set;
    expect(setArg.discountPercentage).toBe(20);
    expect(setArg.autoDiscount).toBe(false);
  });

  it('discount 0 cũng xóa cửa sổ ngày', async () => {
    const pid = oid().toString();
    (ProductMock.findById as any).mockResolvedValue({ _id: pid, name: 'X', brandId: oid() });
    (ProductMock.findOneAndUpdate as any).mockResolvedValue({ _id: pid });

    await ProductMutationService.updateProduct(pid, { discountPercentage: 0 });

    const setArg = (ProductMock.findOneAndUpdate as any).mock.calls[0][1].$set;
    expect(setArg.discountStartDate).toBeNull();
    expect(setArg.discountEndDate).toBeNull();
  });

  it('clamp discount > 100 về 100', async () => {
    const pid = oid().toString();
    (ProductMock.findById as any).mockResolvedValue({ _id: pid, name: 'X', brandId: oid() });
    (ProductMock.findOneAndUpdate as any).mockResolvedValue({ _id: pid });

    await ProductMutationService.updateProduct(pid, { discountPercentage: 150 });

    const setArg = (ProductMock.findOneAndUpdate as any).mock.calls[0][1].$set;
    expect(setArg.discountPercentage).toBe(100);
  });

  it('updateProduct xóa cả cache chi tiết product:detail:{id} (fix #5)', async () => {
    const pid = oid().toString();
    (ProductMock.findById as any).mockResolvedValue({ _id: pid, name: 'X', brandId: oid() });
    (ProductMock.findOneAndUpdate as any).mockResolvedValue({ _id: pid });

    await ProductMutationService.updateProduct(pid, { name: 'New Name' });

    // redis.del(...keys) spread toàn bộ keys vào 1 call — phải gom mọi args
    const deletedKeys = (redis.del as any).mock.calls.flatMap((c: any[]) => c);
    expect(deletedKeys).toContain(`product:detail:${pid}`);
    expect(deletedKeys).toContain(`products:${pid}`);
  });
});

describe('clearProductCache (fix #5 + #13)', () => {
  it('xóa cả cache chi tiết khi truyền productId', async () => {
    const pid = oid().toString();
    await clearProductCache(pid);
    const allDeleted = (redis.del as any).mock.calls.flatMap((c: any[]) => c);
    expect(allDeleted).toContain(`product:detail:${pid}`);
    expect(allDeleted).toContain(`products:${pid}`);
  });

  it('dùng redis.scan, không dùng redis.keys', async () => {
    await clearProductCache();
    expect(redis.scan).toHaveBeenCalled();
    expect((redis as any).keys).not.toHaveBeenCalled();
  });
});

describe('variant safeguards (fix #15)', () => {
  it('updateProduct: giá/tồn kho âm bị clamp về 0', async () => {
    const pid = oid().toString();
    (ProductMock.findById as any).mockResolvedValue({ _id: pid, name: 'X', brandId: oid() });
    (ProductMock.findOneAndUpdate as any).mockResolvedValue({ _id: pid });
    (ProductVariant.insertMany as any).mockResolvedValue([{ _id: oid() }]);

    await ProductMutationService.updateProduct(pid, {
      variants: [{ size: '50ml', price: -5, quantityInStock: -10 }],
    });

    const inserted = (ProductVariant.insertMany as any).mock.calls[0][0][0];
    expect(inserted.price).toBe(0);
    expect(inserted.quantityInStock).toBe(0);
  });

  it('createProduct: tag Limited không ép isNewArrival, tag thường thì có', async () => {
    (Brand.findOne as any).mockResolvedValue({ _id: oid(), name: 'Brand A' });
    (ProductMock.findOne as any).mockResolvedValue(null); // không trùng tên

    await ProductMutationService.createProduct({
      name: 'Limited Perfume',
      brand: 'Brand A',
      tag: 'Limited',
      variants: [{ size: '50ml', price: 100000 }],
    });
    const limitedArg = (ProductMock as any).mock.calls[0][0];
    expect(limitedArg.isNewArrival).toBe(false);

    await ProductMutationService.createProduct({
      name: 'Normal Perfume',
      brand: 'Brand A',
      variants: [{ size: '50ml', price: 100000 }],
    });
    const normalArg = (ProductMock as any).mock.calls[1][0];
    expect(normalArg.isNewArrival).toBe(true);
  });

  it('duplicateProduct: gốc không có slug → slug dùng từ name', async () => {
    const original: any = {
      _id: oid(),
      name: 'Sauvage Dior',
      brandId: oid(),
      variants: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (ProductMock.findById as any).mockReturnValue({ lean: async () => original });
    (ProductVariant.find as any).mockReturnValue({ lean: async () => [] });
    (ProductTag.find as any).mockReturnValue({
      lean: async () => [],
      select: () => ({ lean: async () => [] }),
    });
    (ProductImage.find as any).mockReturnValue({ lean: async () => [] });

    await ProductMutationService.duplicateProduct(original._id.toString());

    const ctorArg = (ProductMock as any).mock.calls[0][0];
    expect(String(ctorArg.slug)).not.toContain('undefined');
    expect(String(ctorArg.slug)).toContain('sauvage-dior');
  });
});
