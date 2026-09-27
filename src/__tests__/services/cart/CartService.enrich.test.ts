import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../models/CartItem.ts', () => ({
  CartItem: { bulkWrite: vi.fn().mockResolvedValue({}) },
  default: { bulkWrite: vi.fn().mockResolvedValue({}) },
}));
vi.mock('../../../models/Product.ts', () => ({ Product: {} }));
vi.mock('../../../models/ProductVariant.ts', () => ({
  ProductVariant: {
    find: vi.fn(() => ({ select: () => ({ lean: async () => [] }) })),
  },
}));
vi.mock('../../../models/ProductImage.ts', () => ({
  ProductImage: {
    find: vi.fn(() => ({ select: () => ({ sort: () => ({ lean: async () => [] }) }) })),
  },
}));
vi.mock('../../../models/User.ts', () => ({ User: {} }));
vi.mock('../../../config/redis.ts', () => ({ redis: {} }));
vi.mock('../../../services/VoucherService.ts', () => ({ VoucherService: {} }));
vi.mock('../../../services/product/productFormatterService.ts', () => ({
  getEffectiveProductDiscount: vi.fn().mockResolvedValue(0),
  getEffectiveProductDiscounts: vi.fn().mockResolvedValue(new Map()),
}));

import { CartService } from '../../../services/cart/CartService.ts';

const pid = '507f1f77bcf86cd799439011';
const vid = '507f1f77bcf86cd799439012';

// cart_item "sống": populate productVariantId → productId đầy đủ object
const liveItem = () => ({
  _id: '607f1f77bcf86cd7994390aa',
  quantity: 2,
  price: 100000,
  productVariantId: {
    _id: vid,
    size: '50ml',
    type: 'fullbox',
    price: 100000,
    productId: { _id: pid, name: 'Nước hoa A', image: '', brandId: null },
  },
});

// cart_item "mồ côi": variant đã bị xóa → populate trả null cho productVariantId
const orphanNullVariant = () => ({
  _id: '607f1f77bcf86cd7994390bb',
  quantity: 1,
  price: 50000,
  productVariantId: null,
});

// cart_item mồ côi kiểu 2: variant còn nhưng product bị xóa → productId null
const orphanNullProduct = () => ({
  _id: '607f1f77bcf86cd7994390cc',
  quantity: 1,
  price: 70000,
  productVariantId: { _id: vid, size: '50ml', price: 70000, productId: null },
});

describe('CartService.enrichItemsWithVariants — lọc cart_items mồ côi (C4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loại bỏ dòng có productVariantId=null (variant đã xóa)', async () => {
    const result = await CartService.enrichItemsWithVariants([liveItem(), orphanNullVariant()]);

    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe(pid);
    // không còn dòng productId '' (thứ từng làm sập checkout ở C1)
    expect(result.some((r) => r.productId === '')).toBe(false);
  });

  it('loại bỏ dòng có productId=null (product đã xóa)', async () => {
    const result = await CartService.enrichItemsWithVariants([liveItem(), orphanNullProduct()]);

    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe(pid);
  });

  it('toàn bộ mồ côi → trả [] (không gọi truy vấn aggregate nào)', async () => {
    const result = await CartService.enrichItemsWithVariants([
      orphanNullVariant(),
      orphanNullProduct(),
    ]);

    expect(result).toEqual([]);
  });

  it('tổng tiền không bị "tiền ảo" từ dòng mồ côi', async () => {
    const items = await CartService.enrichItemsWithVariants([
      liveItem(),
      orphanNullVariant(),
      orphanNullProduct(),
    ]);
    const total = items.reduce((s, i) => s + i.price * (i.quantity || 1), 0);

    // chỉ tính dòng sống: 100000 * 2
    expect(total).toBe(200000);
  });
});
