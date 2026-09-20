import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../models/ProductVariant.ts', () => ({
  ProductVariant: {
    updateOne: vi.fn(),
    findOne: vi.fn(),
  },
}));

vi.mock('../../../models/OrderItem.ts', () => ({
  OrderItem: {
    find: vi.fn(() => ({ lean: async () => [] })),
  },
}));

vi.mock('../../../models/Order.ts', () => ({
  Order: { findById: vi.fn() },
}));

vi.mock('../../../models/Voucher.ts', () => ({
  Voucher: { updateOne: vi.fn() },
}));

vi.mock('../../../models/UserVoucher.ts', () => ({
  UserVoucher: { updateOne: vi.fn() },
}));

import { StockService } from '../../../services/cart/StockService.ts';
import { ProductVariant } from '../../../models/ProductVariant.ts';
import { Order } from '../../../models/Order.ts';
import { OrderItem } from '../../../models/OrderItem.ts';
import { Voucher } from '../../../models/Voucher.ts';
import { UserVoucher } from '../../../models/UserVoucher.ts';

const hexId = '507f1f77bcf86cd799439011';

/** Mock mongoose chain thenable: await model[method]().select() -> result, va .lean() cung -> result */
function chain(model: any, method: 'findOne' | 'findById', result: any) {
  (model[method] as any).mockImplementation(() => ({
    select: () => ({
      lean: async () => result,
      // thenable — dung cho code await ...select() khong qua .lean()
      then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
      catch: (rej: any) => Promise.resolve(result).catch(rej),
    }),
  }));
}

describe('StockService.deductStock — atomic, chặn vượt tồn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('trừ đúng khi đủ hàng (matched → không lỗi)', async () => {
    vi.mocked(ProductVariant.updateOne).mockResolvedValue({ matchedCount: 1 } as any);

    const failures = await StockService.deductStock([
      { productId: hexId, variantSize: '50ml', quantity: 2 },
    ]);

    expect(failures).toHaveLength(0);
    expect(ProductVariant.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ quantityInStock: { $gte: 2 } }),
      { $inc: { quantityInStock: -2 } }
    );
  });

  it('KHÔNG trừ khi vượt tồn — filter $gte chặn, báo 409-style failure kèm tồn khả dụng', async () => {
    vi.mocked(ProductVariant.updateOne).mockResolvedValue({ matchedCount: 0 } as any);
    chain(ProductVariant, 'findOne', { quantityInStock: 1 });

    const failures = await StockService.deductStock([
      { productId: hexId, variantSize: '50ml', quantity: 5 },
    ]);

    expect(failures).toEqual([
      { productId: hexId, variantSize: '50ml', available: 1, requested: 5 },
    ]);
  });

  it('biến thể không tồn tại → failure với note rõ ràng', async () => {
    vi.mocked(ProductVariant.updateOne).mockResolvedValue({ matchedCount: 0 } as any);
    chain(ProductVariant, 'findOne', null);

    const failures = await StockService.deductStock([
      { productId: hexId, variantSize: '999ml', quantity: 1 },
    ]);

    expect(failures[0].variantSize).toContain('không tồn tại');
  });

  it('nhiều item: báo đủ các variant thất bại (để bailing hoàn phần đã trừ)', async () => {
    vi.mocked(ProductVariant.updateOne)
      .mockResolvedValueOnce({ matchedCount: 1 } as any)  // item 1 ok
      .mockResolvedValueOnce({ matchedCount: 0 } as any)  // item 2 fail
      .mockResolvedValueOnce({ matchedCount: 0 } as any); // item 3 fail
    const oneOffResults = [{ quantityInStock: 3 }, { quantityInStock: 0 }];
    let idx = 0;
    (ProductVariant.findOne as any).mockImplementation(() => {
      const result = oneOffResults[idx++] ?? null;
      return { select: () => ({ lean: async () => result }) };
    });

    const failures = await StockService.deductStock([
      { productId: hexId, variantSize: '50ml', quantity: 1 },
      { productId: '507f1f77bcf86cd799439012', variantSize: '100ml', quantity: 2 },
      { productId: '507f1f77bcf86cd799439013', variantSize: '30ml', quantity: 1 },
    ]);

    expect(failures).toHaveLength(2);
    expect(failures[0].available).toBe(3);
    expect(failures[1].available).toBe(0);
  });
});

describe('StockService.restoreStockForOrder — idempotent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hoàn kho cộng ngược đúng số lượng từng item', async () => {
    chain(Order, 'findById', { _id: hexId, resourcesRestored: false, save: vi.fn().mockResolvedValue({}) });
    const items = [
      { productId: hexId, variantSize: '50ml', quantity: 2 },
      { productId: '507f1f77bcf86cd799439012', variantSize: '100ml', quantity: 1 },
    ];
    vi.mocked(OrderItem.find).mockImplementation(() => ({ lean: async () => items } as any));

    await StockService.restoreStockForOrder(hexId);

    expect(ProductVariant.updateOne).toHaveBeenCalledTimes(2);
    expect(ProductVariant.updateOne).toHaveBeenCalledWith(
      { productId: expect.anything(), size: '50ml' },
      { $inc: { quantityInStock: 2 } }
    );
    expect(ProductVariant.updateOne).toHaveBeenCalledWith(
      { productId: expect.anything(), size: '100ml' },
      { $inc: { quantityInStock: 1 } }
    );
  });

  it('REGRESSION: đơn đã hoàn (resourcesRestored=true) → không hoàn lần 2', async () => {
    chain(Order, 'findById', { _id: hexId, resourcesRestored: true, save: vi.fn() });

    const result = await StockService.restoreStockForOrder(hexId);

    expect(result).toBe(false);
    expect(ProductVariant.updateOne).not.toHaveBeenCalled();
  });

  it('REGRESSION: đơn không tồn tại → không hoàn gì', async () => {
    chain(Order, 'findById', null);

    const result = await StockService.restoreStockForOrder('ghost');

    expect(result).toBe(false);
    expect(ProductVariant.updateOne).not.toHaveBeenCalled();
  });
});

describe('StockService.restoreVouchersForOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hoàn voucher giảm giá + freeship: isUsed=false, usedCount -1', async () => {
    chain(Order, 'findById', {
      _id: hexId,
      userId: hexId,
      voucherId: 'v1',
      freeshipVoucherId: 'v2',
    });

    await StockService.restoreVouchersForOrder(hexId);

    expect(Voucher.updateOne).toHaveBeenCalledTimes(2);
    expect(UserVoucher.updateOne).toHaveBeenCalledTimes(2);
    expect(UserVoucher.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ voucherId: 'v1', isUsed: true }),
      expect.objectContaining({ $set: { isUsed: false } })
    );
  });

  it('đơn không dùng voucher → không cập nhật gì', async () => {
    chain(Order, 'findById', {
      _id: hexId, userId: hexId, voucherId: null, freeshipVoucherId: undefined,
    });

    await StockService.restoreVouchersForOrder(hexId);

    expect(Voucher.updateOne).not.toHaveBeenCalled();
    expect(UserVoucher.updateOne).not.toHaveBeenCalled();
  });
});
