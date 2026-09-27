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
vi.mock('../../../models/ProductTag.ts', () => ({
  ProductTag: {
    find: vi.fn(() => ({ lean: async () => [], select: () => ({ lean: async () => [] }) })),
    exists: vi.fn().mockResolvedValue(false),
    create: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    insertMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  },
}));
vi.mock('../../../models/Tag.ts', () => ({
  Tag: { findOne: vi.fn(), find: vi.fn(() => ({ lean: async () => [] })) },
}));
vi.mock('../../../models/Brand.ts', () => ({ Brand: { findOne: vi.fn() } }));
vi.mock('../../../models/Category.ts', () => ({ Category: { findOne: vi.fn() } }));
vi.mock('../../../models/Review.ts', () => ({ Review: {} }));
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
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    insertMany: vi.fn().mockResolvedValue([{ _id: new mongoose.Types.ObjectId() }]),
    find: vi.fn(() => ({ select: () => ({ lean: async () => [] }), lean: async () => [] })),
    distinct: vi.fn(),
    aggregate: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('../../../models/OrderItem.ts', () => ({
  OrderItem: { exists: vi.fn().mockResolvedValue(false) },
}));
vi.mock('../../../models/FlashSale.ts', () => ({ FlashSale: {} }));
vi.mock('../../../models/Favorite.ts', () => ({
  Favorite: { deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }) },
}));
vi.mock('../../../models/CartItem.ts', () => ({
  CartItem: { deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }) },
  default: { deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }) },
}));
vi.mock('../../../services/ImageService.ts', () => ({ ImageService: {
  getFolderFromUrl: vi.fn().mockReturnValue(null),
  deleteFromR2: vi.fn().mockResolvedValue(undefined),
  deleteFolderFromR2: vi.fn().mockResolvedValue(undefined),
} }));
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
import { Tag } from '../../../models/Tag.ts';
import { ProductImage } from '../../../models/ProductImage.ts';
import { Favorite } from '../../../models/Favorite.ts';
import { CartItem } from '../../../models/CartItem.ts';
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

  it('clamp discount > 100 về 100', async () => {
    const pid = oid().toString();
    (ProductMock.findById as any).mockResolvedValue({ _id: pid, name: 'X', brandId: oid() });
    (ProductMock.findOneAndUpdate as any).mockResolvedValue({ _id: pid });

    await ProductMutationService.updateProduct(pid, { discountPercentage: 150 });

    const setArg = (ProductMock.findOneAndUpdate as any).mock.calls[0][1].$set;
    expect(setArg.discountPercentage).toBe(100);
  });

  it('updateProduct quét pattern cache chi tiết của đúng sản phẩm vừa sửa (fix #5)', async () => {
    const pid = oid().toString();
    (ProductMock.findById as any).mockResolvedValue({ _id: pid, name: 'X', brandId: oid() });
    (ProductMock.findOneAndUpdate as any).mockResolvedValue({ _id: pid });

    await ProductMutationService.updateProduct(pid, { name: 'New Name' });

    // scan(cursor, 'MATCH', pattern, 'COUNT', n) — không còn danh sách key tĩnh gắn version.
    const patterns = (redis.scan as any).mock.calls.map((c: any) => c[2]);
    expect(patterns).toContain(`product:detail:*:${pid}`);
    expect(patterns).toContain('products:sale:*');
    expect(patterns).toContain('products:trending:*');
  });
});

describe('clearProductCache (fix #5 + #13)', () => {
  it('quét cả pattern cache chi tiết khi truyền productId', async () => {
    const pid = oid().toString();
    await clearProductCache(pid);
    const patterns = (redis.scan as any).mock.calls.map((c: any) => c[2]);
    expect(patterns).toContain(`product:detail:*:${pid}`);
  });

  it('key scan tìm được thì bị xóa thật', async () => {
    const pid = oid().toString();
    (redis.scan as any).mockImplementation(async (_cursor: string, _match: string, pattern: string) =>
      pattern === `product:detail:*:${pid}` ? ['0', [`product:detail:v2:${pid}`]] : ['0', []]
    );

    await clearProductCache(pid);

    const deletedKeys = (redis.del as any).mock.calls.flatMap((c: any[]) => c);
    expect(deletedKeys).toContain(`product:detail:v2:${pid}`);
  });

  it('dùng redis.scan, không dùng redis.keys', async () => {
    await clearProductCache();
    expect(redis.scan).toHaveBeenCalled();
    expect((redis as any).keys).not.toHaveBeenCalled();
  });

  it('bulkDeleteProducts quét key chi tiết của TỪNG id bị xóa (fix #8)', async () => {
    const ids = [oid().toString(), oid().toString()];
    (ProductMock.find as any).mockReturnValue({ lean: async () => ids.map((id) => ({ _id: id, variants: [] })) });
    (ProductImage.find as any).mockReturnValue({ lean: async () => [] });
    (ProductMock.deleteMany as any).mockResolvedValue({ deletedCount: ids.length });

    await ProductMutationService.bulkDeleteProducts(ids);

    const patterns = (redis.scan as any).mock.calls.map((c: any) => c[2]);
    expect(patterns).toContain(`product:detail:*:${ids[0]}`);
    expect(patterns).toContain(`product:detail:*:${ids[1]}`);
    // Key `products:<id>` không service nào ghi — xóa nó là ăn gian, trang chi tiết vẫn
    // served bản đã xóa tới hết TTL.
    const deletedKeys = (redis.del as any).mock.calls.flatMap((c: any[]) => c);
    expect(deletedKeys).not.toContain(`products:${ids[0]}`);
  });
});

describe('updateProduct — provenance của tag (fix #7)', () => {
  it('link auto có sẵn mà admin chọn lại bị nâng lên manual', async () => {
    const pid = oid().toString();
    const tagId = oid();
    (ProductMock.findById as any).mockResolvedValue({ _id: pid, name: 'X', brandId: oid() });
    (ProductMock.findOneAndUpdate as any).mockResolvedValue({ _id: pid });
    (Tag.find as any).mockReturnValue({ lean: async () => [{ _id: tagId, slug: 'limited', name: 'Limited' }] });
    // Link đã tồn tại (do sync gán, source 'auto') → notInsert, nhưng phải được nâng cấp.
    (ProductTag.find as any).mockReturnValue({
      select: () => ({ lean: async () => [{ tagId }] }),
      lean: async () => [{ tagId, source: 'auto' }],
    });

    await ProductMutationService.updateProduct(pid, { tag: 'Limited' });

    expect(ProductTag.updateMany).toHaveBeenCalledWith(
      { productId: pid, tagId: { $in: [tagId] }, source: { $ne: 'manual' } },
      { $set: { source: 'manual' } }
    );
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
});

describe('deleteProduct — cascade favorites (G1)', () => {
  it('xóa 1 product thì xóa luôn favorite trỏ tới nó', async () => {
    const pid = oid().toString();
    (ProductMock.findOne as any).mockResolvedValue({ _id: pid, variants: [] });
    (ProductMock.deleteOne as any).mockResolvedValue({ deletedCount: 1 });

    await ProductMutationService.deleteProduct(pid);

    expect(Favorite.deleteMany).toHaveBeenCalledWith({ productId: pid });
  });

  it('bulkDeleteProducts xóa favorite theo danh sách id', async () => {
    const ids = [oid().toString(), oid().toString()];
    (ProductMock.find as any).mockReturnValue({ lean: async () => ids.map((id) => ({ _id: id, variants: [] })) });
    (ProductImage.find as any).mockReturnValue({ lean: async () => [] });
    (ProductMock.deleteMany as any).mockResolvedValue({ deletedCount: ids.length });

    await ProductMutationService.bulkDeleteProducts(ids);

    expect(Favorite.deleteMany).toHaveBeenCalledWith({ productId: { $in: ids } });
  });
});

describe('updateProduct — syncVariantsPreservingIds (C3)', () => {
  it('size trùng khớp → update tại chỗ giữ _id, KHÔNG insert lại', async () => {
    const pid = oid().toString();
    const existingVid = oid();
    (ProductMock.findById as any).mockResolvedValue({ _id: pid, name: 'X', brandId: oid() });
    (ProductMock.findOneAndUpdate as any).mockResolvedValue({ _id: pid });
    (ProductVariant.find as any).mockReturnValue({
      select: () => ({ lean: async () => [{ _id: existingVid, size: '50ml' }] }),
      lean: async () => [],
    });

    await ProductMutationService.updateProduct(pid, {
      variants: [{ size: '50ml', price: 200000, quantityInStock: 5 }],
    });

    // giữ _id cũ → updateOne theo _id, không tái tạo bằng insertMany
    expect(ProductVariant.updateOne).toHaveBeenCalledWith(
      { _id: existingVid },
      expect.objectContaining({ $set: expect.objectContaining({ price: 200000 }) })
    );
    expect(ProductVariant.insertMany).not.toHaveBeenCalled();
  });

  it('size bị bỏ → xóa variant cũ và cascade dọn cart_items trỏ tới nó', async () => {
    const pid = oid().toString();
    const keepVid = oid();
    const removedVid = oid();
    (ProductMock.findById as any).mockResolvedValue({ _id: pid, name: 'X', brandId: oid() });
    (ProductMock.findOneAndUpdate as any).mockResolvedValue({ _id: pid });
    (ProductVariant.find as any).mockReturnValue({
      select: () => ({
        lean: async () => [
          { _id: keepVid, size: '50ml' },
          { _id: removedVid, size: '100ml' },
        ],
      }),
      lean: async () => [],
    });

    await ProductMutationService.updateProduct(pid, {
      variants: [{ size: '50ml', price: 200000, quantityInStock: 5 }],
    });

    expect(ProductVariant.deleteMany).toHaveBeenCalledWith({ _id: { $in: [removedVid] } });
    expect(CartItem.deleteMany).toHaveBeenCalledWith({ productVariantId: { $in: [removedVid] } });
    // variant giữ lại không bị xóa
    const delArg = (ProductVariant.deleteMany as any).mock.calls.at(-1)[0]._id.$in;
    expect(delArg).not.toContainEqual(keepVid);
  });
});

describe('deleteProduct — cascade cart_items (H1)', () => {
  it('xóa 1 product thì xóa dòng giỏ hàng trỏ tới variant của nó', async () => {
    const pid = oid().toString();
    const vid = oid();
    (ProductMock.findOne as any).mockResolvedValue({ _id: pid });
    (ProductMock.deleteOne as any).mockResolvedValue({ deletedCount: 1 });
    (ProductVariant.find as any).mockReturnValue({ select: () => ({ lean: async () => [{ _id: vid }] }) });

    await ProductMutationService.deleteProduct(pid);

    expect(CartItem.deleteMany).toHaveBeenCalledWith({ productVariantId: { $in: [vid] } });
  });

  it('bulkDeleteProducts xóa dòng giỏ hàng theo variant ids', async () => {
    const id1 = oid().toString();
    const vid = oid();
    (ProductMock.find as any).mockReturnValue({ lean: async () => [{ _id: id1 }] });
    (ProductImage.find as any).mockReturnValue({ lean: async () => [] });
    (ProductVariant.find as any).mockReturnValue({ select: () => ({ lean: async () => [{ _id: vid }] }) });
    (ProductMock.deleteMany as any).mockResolvedValue({ deletedCount: 1 });

    await ProductMutationService.bulkDeleteProducts([id1]);

    expect(CartItem.deleteMany).toHaveBeenCalledWith({ productVariantId: { $in: [vid] } });
  });
});
