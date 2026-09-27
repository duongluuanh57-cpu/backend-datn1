import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

const oid = () => new mongoose.Types.ObjectId();

const store = vi.hoisted(() => ({
  variants: [] as any[],
  flashSales: [] as any[],
  products: [] as any[],
}));

function chain(value: any): any {
  return {
    select: () => chain(value),
    populate: () => chain(value),
    lean: async () => value,
  };
}

vi.mock('../../../models/Product.ts', () => ({ Product: { find: () => chain(store.products) } }));
vi.mock('../../../models/ProductImage.ts', () => ({ ProductImage: { find: () => chain([]) } }));
vi.mock('../../../models/ProductVariant.ts', () => ({ ProductVariant: { find: () => chain(store.variants) } }));
vi.mock('../../../models/ProductTag.ts', () => ({ ProductTag: { find: () => chain([]) } }));
vi.mock('../../../models/Category.ts', () => ({ Category: { find: () => chain([]) } }));
vi.mock('../../../models/Review.ts', () => ({ Review: { aggregate: async () => [] } }));
vi.mock('../../../models/FlashSale.ts', () => ({ FlashSale: { find: () => chain(store.flashSales) } }));

import {
  getDefaultVariant,
  getDisplayVariant,
  formatMultipleProducts,
  getEffectiveProductDiscounts,
  invalidateFlashSaleFormatterCache,
} from '../../../services/product/productFormatterService.ts';

function variant(productId: any, size: string, price: number, quantityInStock: number) {
  return { _id: oid(), productId, size, price, quantityInStock, isDefault: false };
}

function flashSale(items: any[], status = 'active') {
  return { _id: oid(), name: 'Flash Sale', status, items };
}

describe('variant defaults', () => {
  const pid = oid();

  it('chọn biến thể dung tích lớn nhất còn hàng', () => {
    const variants = [variant(pid, '10ml', 300000, 5), variant(pid, '100ml', 2500000, 2), variant(pid, '50ml', 1400000, 0)];
    expect(getDefaultVariant(variants).size).toBe('100ml');
  });

  it('trả null khi mọi biến thể đã hết hàng — không lấy size 0 tồn kho làm mặc định', () => {
    const variants = [variant(pid, '10ml', 300000, 0), variant(pid, '100ml', 2500000, 0)];
    expect(getDefaultVariant(variants)).toBeNull();
  });

  it('vẫn có giá hiển thị cho sản phẩm sold out', () => {
    const variants = [variant(pid, '10ml', 300000, 0), variant(pid, '100ml', 2500000, 0)];
    expect(getDisplayVariant(variants).price).toBe(2500000);
  });

  it('null khi sản phẩm không có biến thể', () => {
    expect(getDefaultVariant([])).toBeNull();
    expect(getDisplayVariant([])).toBeNull();
  });
});

describe('formatMultipleProducts', () => {
  const pid = oid();

  beforeEach(() => {
    store.variants = [];
    store.flashSales = [];
    store.products = [];
    invalidateFlashSaleFormatterCache();
  });

  it('không áp giảm giá flash-sale khi ngân sách soldCount đã vượt stockLimit', async () => {
    store.variants = [variant(pid, '100ml', 2000000, 10)];
    store.flashSales = [flashSale([{ productId: pid, extraDiscountPercentage: 20, stockLimit: 5, soldCount: 5 }])];

    const [p] = await formatMultipleProducts([{ _id: pid, name: 'A', discountPercentage: 10, soldCount: 0 }]);
    expect(p.discount).toBe(10);
    expect(p.price).toBe(1800000);
    expect(p.flashSale).toBe('Flash Sale');
  });

  it('áp giảm giá flash-sale khi còn ngân sách', async () => {
    store.variants = [variant(pid, '100ml', 2000000, 10)];
    store.flashSales = [flashSale([{ productId: pid, extraDiscountPercentage: 20, stockLimit: 50, soldCount: 5 }])];

    const [p] = await formatMultipleProducts([{ _id: pid, name: 'A', discountPercentage: 10, soldCount: 0 }]);
    expect(p.discount).toBe(30);
    expect(p.price).toBe(1400000);
    expect(p.flashSale).toBe('Flash Sale (-20%)');
  });

  it('sản phẩm không có biến thể: tồn kho 0 và không bịa defaultVariantSize', async () => {
    const [p] = await formatMultipleProducts([{ _id: pid, name: 'A', discountPercentage: 0, soldCount: 0 }]);
    expect(p.quantityInStock).toBe(0);
    expect(p.defaultVariantSize).toBe('');
    expect(p.price).toBe(0);
  });

  it('defaultVariantSize là size có thật còn hàng, không phải 100ml cảm tính', async () => {
    store.variants = [variant(pid, '10ml', 300000, 4), variant(pid, '50ml', 1400000, 0)];
    const [p] = await formatMultipleProducts([{ _id: pid, name: 'A', discountPercentage: 0, soldCount: 0 }]);
    expect(p.defaultVariantSize).toBe('10ml');
    expect(p.originalPrice).toBe(300000);
  });
});

describe('getEffectiveProductDiscounts', () => {
  const pid = oid();

  beforeEach(() => {
    store.flashSales = [];
    store.products = [{ _id: pid, discountPercentage: 10 }];
    invalidateFlashSaleFormatterCache();
  });

  it('trùng với discount mà card sản phẩm hiển thị khi flash-sale cạn ngân sách', async () => {
    store.flashSales = [flashSale([{ productId: pid, extraDiscountPercentage: 20, stockLimit: 5, soldCount: 5 }])];
    const map = await getEffectiveProductDiscounts([pid]);
    expect(map.get(pid.toString())).toBe(10);
  });

  it('cộng phần giảm thêm khi flash-sale còn ngân sách', async () => {
    store.flashSales = [flashSale([{ productId: pid, extraDiscountPercentage: 20, stockLimit: 50, soldCount: 5 }])];
    const map = await getEffectiveProductDiscounts([pid]);
    expect(map.get(pid.toString())).toBe(30);
  });
});
