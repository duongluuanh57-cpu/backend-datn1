import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../models/FlashSale.ts', () => {
  const doc = (overrides: any = {}) => ({
    save: vi.fn().mockResolvedValue({ _id: 'fs1', ...overrides }),
    items: (overrides.items || []).slice(),
    name: overrides.name || '',
    startDate: overrides.startDate,
    endDate: overrides.endDate,
    status: overrides.status || 'scheduled',
    ...overrides,
  });

  const mock: any = vi.fn(function (this: any, data: any) { return doc(data); });
  mock.findById = vi.fn();
  mock.findOne = vi.fn();
  mock.find = vi.fn();
  mock.updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
  mock.updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  mock.findByIdAndDelete = vi.fn();
  mock.countDocuments = vi.fn();
  return { FlashSale: mock, IFlashSale: {} };
});

vi.mock('../../models/Product.ts', () => ({
  Product: { exists: vi.fn() },
}));

vi.mock('../../config/redis.ts', () => ({
  redis: {
    del: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../services/product/productFormatterService.ts', () => ({
  formatMultipleProducts: vi.fn(),
}));

import { FlashSaleService } from '../../services/FlashSaleService.ts';
import { FlashSale } from '../../models/FlashSale.ts';
import { Product } from '../../models/Product.ts';
import { redis } from '../../config/redis.ts';
import { formatMultipleProducts } from '../../services/product/productFormatterService.ts';

const oid = (s: string) => {
  const hex = s.replace(/[^0-9a-fA-F]/g, '0') || '0';
  return new mongoose.Types.ObjectId(hex.padEnd(24, '0').slice(0, 24));
};

beforeEach(() => {
  vi.clearAllMocks();
  (FlashSale.find as any).mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });
});

describe('FlashSaleService', () => {
  describe('calculateStatus', () => {
    it('returns inactive when requestedStatus is inactive', () => {
      expect(FlashSaleService.calculateStatus(new Date('2030-01-01'), new Date('2030-01-02'), 'inactive')).toBe('inactive');
    });

    it('returns scheduled when start is in the future', () => {
      expect(FlashSaleService.calculateStatus(new Date('2030-01-01'), new Date('2030-01-02'))).toBe('scheduled');
    });

    it('returns active when now is within window', () => {
      expect(FlashSaleService.calculateStatus(new Date('2020-01-01'), new Date('2030-01-01'))).toBe('active');
    });

    it('returns ended when end has passed', () => {
      expect(FlashSaleService.calculateStatus(new Date('2020-01-01'), new Date('2020-01-02'))).toBe('ended');
    });
  });

  describe('clearCache', () => {
    it('deletes known keys and products:public:* keys', async () => {
      (redis.keys as any).mockResolvedValue(['products:public:page1', 'products:public:page2']);
      await FlashSaleService.clearCache();
      expect(redis.del).toHaveBeenCalled();
      const args = (redis.del as any).mock.calls[0][0];
      expect(args).toContain('homepage:v4');
      expect(args).toContain('products:trending:tag:v5');
      expect(redis.keys).toHaveBeenCalledWith('products:public:*');
      expect(redis.del).toHaveBeenCalledWith(['products:public:page1', 'products:public:page2']);
    });
  });

  describe('create', () => {
    it('throws when name is missing', async () => {
      await expect(FlashSaleService.create({} as any)).rejects.toThrow('Tên sự kiện Flash Sale là bắt buộc');
    });

    it('throws when dates are invalid', async () => {
      await expect(FlashSaleService.create({ name: 'X', startDate: 'abc', endDate: 'def' } as any)).rejects.toThrow('Thời gian bắt đầu/kết thúc không hợp lệ');
    });

    it('throws when end is before start', async () => {
      await expect(
        FlashSaleService.create({ name: 'X', startDate: '2026-01-02', endDate: '2026-01-01' } as any)
      ).rejects.toThrow('Thời gian kết thúc phải sau thời gian bắt đầu');
    });

    it('throws when more than 20 items', async () => {
      const items = Array.from({ length: 21 }, (_, i) => ({
        productId: new mongoose.Types.ObjectId().toString(),
        extraDiscountPercentage: 10,
        stockLimit: 10,
        soldCount: 0,
      }));
      await expect(
        FlashSaleService.create({ name: 'X', startDate: '2026-01-01', endDate: '2026-01-02', items } as any)
      ).rejects.toThrow('tối đa 20 sản phẩm');
    });

    it('saves with calculated status and clears cache', async () => {
      const saved = await FlashSaleService.create({
        name: 'FS 2026',
        startDate: '2030-01-01',
        endDate: '2030-01-02',
      } as any);
      expect(FlashSale).toHaveBeenCalledWith(expect.objectContaining({ name: 'FS 2026', status: 'scheduled' }));
      expect(saved._id).toBe('fs1');
      expect(redis.del).toHaveBeenCalled();
    });

    it('sanitizes items (clamps percentages and stock, drops invalid ids)', async () => {
      const goodId = new mongoose.Types.ObjectId().toString();
      await FlashSaleService.create({
        name: 'X',
        startDate: '2030-01-01',
        endDate: '2030-01-02',
        items: [
          { productId: goodId, extraDiscountPercentage: 500, stockLimit: -5, soldCount: 3.7 },
          { productId: 'not-a-valid-id', extraDiscountPercentage: 10, stockLimit: 1, soldCount: 0 },
          { extraDiscountPercentage: 10, stockLimit: 1, soldCount: 0 },
        ],
      } as any);
      const callArgs = (FlashSale as any).mock.calls[0][0];
      expect(callArgs.items).toHaveLength(1);
      expect(callArgs.items[0].productId.toString()).toBe(goodId);
      expect(callArgs.items[0].extraDiscountPercentage).toBe(100);
      expect(callArgs.items[0].stockLimit).toBe(0);
      expect(callArgs.items[0].soldCount).toBe(4);
    });
  });

  describe('update', () => {
    it('throws when not found', async () => {
      (FlashSale.findById as any).mockResolvedValue(null);
      await expect(FlashSaleService.update('x', { name: 'Y' })).rejects.toThrow('Không tìm thấy sự kiện Flash Sale');
    });

    it('updates fields and clears cache', async () => {
      const existing: any = {
        name: 'Old',
        startDate: new Date('2020-01-01'),
        endDate: new Date('2020-01-02'),
        items: [],
      };
      existing.save = vi.fn().mockResolvedValue(existing);
      (FlashSale.findById as any).mockResolvedValue(existing);
      const result = await FlashSaleService.update('fs1', {
        name: 'New',
        startDate: '2030-01-01',
        endDate: '2030-01-02',
      } as any);
      expect(existing.name).toBe('New');
      expect(existing.status).toBe('scheduled');
      expect(existing.save).toHaveBeenCalled();
      expect(redis.del).toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('throws when end is before start', async () => {
      const existing: any = {
        name: 'Old',
        startDate: new Date('2020-01-01'),
        endDate: new Date('2020-01-02'),
        items: [],
        save: vi.fn(),
      };
      (FlashSale.findById as any).mockResolvedValue(existing);
      await expect(FlashSaleService.update('fs1', { startDate: '2030-01-02', endDate: '2030-01-01' } as any))
        .rejects.toThrow('Thời gian kết thúc phải sau thời gian bắt đầu');
    });
  });

  describe('delete', () => {
    it('throws when not found', async () => {
      (FlashSale.findByIdAndDelete as any).mockResolvedValue(null);
      await expect(FlashSaleService.delete('x')).rejects.toThrow('Không tìm thấy sự kiện Flash Sale để xóa');
    });

    it('deletes and clears cache', async () => {
      (FlashSale.findByIdAndDelete as any).mockResolvedValue({ _id: 'fs1' });
      const result = await FlashSaleService.delete('fs1');
      expect(FlashSale.findByIdAndDelete).toHaveBeenCalledWith('fs1');
      expect(result).toEqual({ _id: 'fs1' });
      expect(redis.del).toHaveBeenCalled();
    });
  });

  describe('assignProduct', () => {
    it('throws on invalid productId', async () => {
      await expect(FlashSaleService.assignProduct('nope', null)).rejects.toThrow('productId không hợp lệ');
    });

    it('throws when product does not exist', async () => {
      (Product.exists as any).mockResolvedValue(false);
      await expect(FlashSaleService.assignProduct(oid('a').toString(), null)).rejects.toThrow('Không tìm thấy sản phẩm');
    });

    it('throws when flash sale not found', async () => {
      (Product.exists as any).mockResolvedValue(true);
      (FlashSale.findById as any).mockResolvedValue(null);
      await expect(FlashSaleService.assignProduct(oid('a').toString(), oid('b').toString())).rejects.toThrow('Không tìm thấy sự kiện Flash Sale');
    });

    it('adds product to flash sale and clears cache', async () => {
      (Product.exists as any).mockResolvedValue(true);
      const fs: any = { items: [], save: vi.fn().mockResolvedValue({ _id: 'fs1' }) };
      (FlashSale.findById as any).mockResolvedValue(fs);
      const result = await FlashSaleService.assignProduct(oid('a').toString(), oid('b').toString(), 20, 5);
      expect(FlashSale.updateMany).toHaveBeenCalled();
      expect(fs.items).toHaveLength(1);
      expect(fs.items[0].extraDiscountPercentage).toBe(20);
      expect(fs.items[0].stockLimit).toBe(5);
      expect(fs.save).toHaveBeenCalled();
      expect(redis.del).toHaveBeenCalled();
      expect(result).toEqual({ _id: 'fs1' });
    });

    it('rejects when flash sale already has 20 items', async () => {
      (Product.exists as any).mockResolvedValue(true);
      const items = Array.from({ length: 20 }, () => ({ productId: oid('x').toString() }));
      const fs: any = { items, save: vi.fn() };
      (FlashSale.findById as any).mockResolvedValue(fs);
      await expect(FlashSaleService.assignProduct(oid('a').toString(), oid('b').toString()))
        .rejects.toThrow('tối đa 20 sản phẩm');
    });
  });

  describe('recordFlashSalePurchases', () => {
    const productId1 = oid('111111111111111111111111').toString();
    const productId2 = oid('222222222222222222222222').toString();

    it('returns early when no active sales', async () => {
      (FlashSale.find as any).mockResolvedValue([]);
      await FlashSaleService.recordFlashSalePurchases([{ productId: productId1, quantity: 2 }]);
      expect(FlashSale.updateOne).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('caps soldCount at stockLimit', async () => {
      (FlashSale.find as any).mockResolvedValue([
        {
          _id: oid('333333333333333333333333'),
          items: [
            { productId: oid('111111111111111111111111'), stockLimit: 5, soldCount: 4 },
          ],
        },
      ]);
      await FlashSaleService.recordFlashSalePurchases([{ productId: productId1, quantity: 3 }]);
      expect(FlashSale.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.anything() }),
        { $set: { 'items.$.soldCount': 5 } }
      );
      expect(redis.del).toHaveBeenCalled();
    });

    it('skips products not in the flash sale and handles multiple purchases', async () => {
      (FlashSale.find as any).mockResolvedValue([
        {
          _id: oid('333333333333333333333333'),
          items: [
            { productId: oid('111111111111111111111111'), stockLimit: 10, soldCount: 1 },
          ],
        },
      ]);
      await FlashSaleService.recordFlashSalePurchases([
        { productId: productId1, quantity: 2 },
        { productId: productId2, quantity: 5 },
      ]);
      expect(FlashSale.updateOne).toHaveBeenCalledTimes(1);
      expect((FlashSale.updateOne as any).mock.calls[0][1]).toEqual({ $set: { 'items.$.soldCount': 3 } });
    });
  });

  describe('getActiveFlashSale', () => {
    it('returns null when nothing found', async () => {
      (FlashSale.findOne as any).mockReturnValue({
        populate: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }),
        sort: vi.fn().mockReturnValue({
          populate: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }),
        }),
      });
      const result = await FlashSaleService.getActiveFlashSale();
      expect(result).toBeNull();
    });

    it('computes flash price from base + extra discount', async () => {
      const active = {
        _id: oid('444444444444444444444444'),
        name: 'FS Active',
        startDate: new Date('2020-01-01'),
        endDate: new Date('2030-01-01'),
        status: 'active',
        items: [{ productId: oid('111111111111111111111111'), extraDiscountPercentage: 10, stockLimit: 20, soldCount: 5 }],
      };
      (FlashSale.findOne as any).mockReturnValue({
        populate: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(active) }),
      });
      (formatMultipleProducts as any).mockResolvedValue([
        {
          _id: oid('111111111111111111111111'),
          name: 'Perfume',
          price: 900_000,
          originalPrice: 1_000_000,
          discountPercentage: 10,
        },
      ]);

      const result = await FlashSaleService.getActiveFlashSale();
      expect(result).not.toBeNull();
      expect(result.items).toHaveLength(1);
      const item = result.items[0];
      expect(item.totalDiscount).toBe(20); // 10 base + 10 extra
      expect(item.originalPrice).toBe(1_000_000);
      expect(item.flashPrice).toBe(800_000);
      expect(item.soldPercentage).toBe(25);
    });

    it('falls back to a scheduled sale when none active', async () => {
      (FlashSale.findOne as any)
        .mockReturnValueOnce({ populate: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) })
        .mockReturnValue({
          sort: vi.fn().mockReturnValue({
            populate: vi.fn().mockReturnValue({
              lean: vi.fn().mockResolvedValue({
                _id: oid('555555555555555555555555'),
                name: 'FS Scheduled',
                startDate: new Date('2030-01-01'),
                endDate: new Date('2030-01-02'),
                status: 'scheduled',
                items: [],
              }),
            }),
          }),
        });
      const result = await FlashSaleService.getActiveFlashSale();
      expect(result?.status).toBe('scheduled');
    });
  });

  describe('getActiveFlashSaleProductIds', () => {
    it('collects product ids from active sales', async () => {
      (FlashSale.find as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([
            { items: [{ productId: oid('111111111111111111111111') }, { productId: oid('222222222222222222222222') }] },
            { items: [{ productId: oid('333333333333333333333333') }] },
          ]),
        }),
      });
      const ids = await FlashSaleService.getActiveFlashSaleProductIds();
      expect(ids.map(String)).toEqual([
        '111111111111111111111111',
        '222222222222222222222222',
        '333333333333333333333333',
      ]);
    });
  });

  describe('getAdminFlashSales', () => {
    it('paginates and returns total pages', async () => {
      (FlashSale.find as any).mockReturnValue({
        sort: vi.fn().mockReturnValue({ skip: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ populate: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{ _id: 'a' }]) }) }) }) }),
      });
      (FlashSale.countDocuments as any).mockResolvedValue(5);
      const result = await FlashSaleService.getAdminFlashSales({ page: 1, limit: 2 });
      expect(result.items).toEqual([{ _id: 'a' }]);
      expect(result.pagination.total).toBe(5);
      expect(result.pagination.totalPages).toBe(3);
    });
  });

  describe('getById', () => {
    it('returns null when not found', async () => {
      (FlashSale.findById as any).mockReturnValue({ populate: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) });
      expect(await FlashSaleService.getById('x')).toBeNull();
    });

    it('formats items with product info', async () => {
      (FlashSale.findById as any).mockReturnValue({
        populate: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue({
            _id: 'fs1',
            name: 'FS',
            items: [{ productId: oid('111111111111111111111111'), extraDiscountPercentage: 10 }],
          }),
        }),
      });
      (formatMultipleProducts as any).mockResolvedValue([
        { _id: oid('111111111111111111111111'), name: 'Perfume', originalPrice: 500_000, discountPercentage: 5 },
      ]);
      const result = await FlashSaleService.getById('fs1');
      expect(result.items[0].productId.name).toBe('Perfume');
      expect(result.items[0].productId.price).toBe(500_000);
    });
  });
});
