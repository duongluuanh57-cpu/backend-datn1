/**
 * saleProductsFlashGate.test.ts — mục "sale" của trang chủ chỉ được dán badge flash sale
 * cho ĐỢT ĐANG CHẠY. `FlashSaleService.getActiveFlashSale()` tự fallback sang đợt
 * `scheduled`, mà hàng của đợt chưa chạy thì không được formatter giảm giá.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

const oid = () => new mongoose.Types.ObjectId();

const FS_PRODUCT = oid();

vi.mock('../../../services/product/discountLifecycleService.ts', () => ({
  DiscountLifecycleService: { syncAutoDiscounts: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../../config/redis.ts', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    scan: vi.fn().mockResolvedValue(['0', []]),
    del: vi.fn().mockResolvedValue(1),
  },
}));
vi.mock('../../../services/product/productFormatterService.ts', () => ({
  // Formatter thật trả bản đã tính giá; giữ nguyên doc để kiểm đúng phần gating.
  formatMultipleProducts: vi.fn(async (docs: any[]) => docs),
  formatProduct: vi.fn(async (doc: any) => doc),
  getDefaultVariant: vi.fn().mockReturnValue(null),
  getDisplayVariant: vi.fn().mockReturnValue(null),
}));
vi.mock('../../../services/FlashSaleService.ts', () => ({
  FlashSaleService: {
    getActiveFlashSale: vi.fn(),
    getActiveFlashSaleProductIds: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('../../../models/Product.ts', () => ({
  Product: {
    find: vi.fn(() => {
      const chain: any = {
        populate: () => chain,
        sort: () => chain,
        limit: () => chain,
        lean: async () => [{ _id: FS_PRODUCT, name: 'FS Item', status: 'active' }],
      };
      return chain;
    }),
    countDocuments: vi.fn(() => ({ maxTimeMS: async () => 0 })),
  },
}));
vi.mock('../../../models/Tag.ts', () => ({
  Tag: { find: vi.fn(() => ({ lean: async () => [] })) },
}));

import { ProductQueryService } from '../../../services/product/productQueryService.ts';
import { FlashSaleService } from '../../../services/FlashSaleService.ts';

const fsDoc = (status: string) => ({
  _id: oid(),
  status,
  name: `Đợt ${status}`,
  items: [{ productId: { _id: FS_PRODUCT }, stockLimit: 10, soldCount: 4 }],
});

beforeEach(() => {
  vi.clearAllMocks();
  // Tag cache là static Map sống suốt process — đặt lại để test không đọc lẫn nhau.
  (ProductQueryService as any).tagCache.clear();
});

describe('getSaleProducts — chỉ đợt đang chạy mới là flash sale', () => {
  it('đợt scheduled không được dán badge, dù getActiveFlashSale trả về nó', async () => {
    (FlashSaleService.getActiveFlashSale as any).mockResolvedValue(fsDoc('scheduled'));

    const result = await ProductQueryService.getSaleProducts();

    expect(result.some((p: any) => p.isFlashSale)).toBe(false);
  });

  it('đợt active thì badge + quota của item được gắn thật', async () => {
    (FlashSaleService.getActiveFlashSale as any).mockResolvedValue(fsDoc('active'));

    const result = await ProductQueryService.getSaleProducts();

    const flagged = result.find((p: any) => p.isFlashSale);
    expect(flagged).toBeTruthy();
    expect(flagged.stockLimit).toBe(10);
    expect(flagged.soldCount).toBe(4);
  });

  it('item chưa populate (productId là id trần) vẫn khớp', async () => {
    (FlashSaleService.getActiveFlashSale as any).mockResolvedValue({
      _id: oid(),
      status: 'active',
      items: [{ productId: FS_PRODUCT, stockLimit: 5, soldCount: 1 }],
    });

    const result = await ProductQueryService.getSaleProducts();

    expect(result.find((p: any) => p.isFlashSale)?.stockLimit).toBe(5);
  });
});
