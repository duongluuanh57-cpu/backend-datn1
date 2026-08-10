import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/Voucher.ts', () => {
  const store: any[] = [];
  const mock: any = {
    _store: store,
    find: vi.fn().mockReturnThis(),
    findOne: vi.fn().mockReturnThis(),
    create: vi.fn(),
    deleteOne: vi.fn(),
    sort: vi.fn().mockReturnThis(),
    lean: vi.fn().mockImplementation(function (this: any) {
      return Promise.resolve(this._result ?? []);
    }),
    _result: [] as any[],
  };
  return {
    Voucher: mock,
    VoucherType: {},
  };
});

import { VoucherService } from '../../services/VoucherService.ts';
import { Voucher } from '../../models/Voucher.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

function chainWith(result: any) {
  (Voucher.find as any).mockReturnValue({
    sort: () => ({ lean: () => Promise.resolve(result) }),
  });
  (Voucher.findOne as any).mockReturnValue({
    lean: () => Promise.resolve(result),
  });
}

describe('VoucherService', () => {
  describe('validate', () => {
    it('rejects non-existent voucher', async () => {
      (Voucher.findOne as any).mockReturnValue({ lean: () => Promise.resolve(null) });
      const result = await VoucherService.validate('NOPE', 100_000);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('không tồn tại');
    });

    it('rejects inactive voucher', async () => {
      (Voucher.findOne as any).mockReturnValue({
        lean: () => Promise.resolve({ code: 'X', status: 'inactive', startDate: new Date('2020-01-01'), endDate: new Date('2030-01-01'), maxUsage: 0, usedCount: 0, minOrderAmount: 0, type: 'fixed', value: 10000 }),
      });
      const result = await VoucherService.validate('X', 100_000);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('vô hiệu hoá');
    });

    it('rejects expired voucher', async () => {
      (Voucher.findOne as any).mockReturnValue({
        lean: () => Promise.resolve({ code: 'X', status: 'active', startDate: new Date('2020-01-01'), endDate: new Date('2023-01-01'), maxUsage: 0, usedCount: 0, minOrderAmount: 0, type: 'fixed', value: 10000 }),
      });
      const result = await VoucherService.validate('X', 100_000);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('hết hạn');
    });

    it('rejects when minOrderAmount not met', async () => {
      (Voucher.findOne as any).mockReturnValue({
        lean: () => Promise.resolve({ code: 'X', status: 'active', startDate: new Date('2020-01-01'), endDate: new Date('2030-01-01'), maxUsage: 0, usedCount: 0, minOrderAmount: 500_000, type: 'fixed', value: 10000 }),
      });
      const result = await VoucherService.validate('X', 100_000);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('tối thiểu');
    });

    it('accepts valid fixed voucher and returns discountAmount', async () => {
      (Voucher.findOne as any).mockReturnValue({
        lean: () => Promise.resolve({ code: 'SAVE', status: 'active', startDate: new Date('2020-01-01'), endDate: new Date('2030-01-01'), maxUsage: 0, usedCount: 0, minOrderAmount: 0, type: 'fixed', value: 50000 }),
      });
      const result = await VoucherService.validate('SAVE', 200_000);
      expect(result.valid).toBe(true);
      expect(result.discountAmount).toBe(50000);
    });

    it('calculates percentage discount capped at maxDiscount', async () => {
      (Voucher.findOne as any).mockReturnValue({
        lean: () => Promise.resolve({ code: 'PCT', status: 'active', startDate: new Date('2020-01-01'), endDate: new Date('2030-01-01'), maxUsage: 0, usedCount: 0, minOrderAmount: 0, type: 'percentage', value: 20, maxDiscount: 100_000 }),
      });
      const result = await VoucherService.validate('PCT', 1_000_000);
      expect(result.valid).toBe(true);
      expect(result.discountAmount).toBe(100_000);
    });

    it('calculates percentage discount without cap', async () => {
      (Voucher.findOne as any).mockReturnValue({
        lean: () => Promise.resolve({ code: 'PCT2', status: 'active', startDate: new Date('2020-01-01'), endDate: new Date('2030-01-01'), maxUsage: 0, usedCount: 0, minOrderAmount: 0, type: 'percentage', value: 10, maxDiscount: 0 }),
      });
      const result = await VoucherService.validate('PCT2', 200_000);
      expect(result.valid).toBe(true);
      expect(result.discountAmount).toBe(20_000);
    });
  });

  describe('create', () => {
    it('uppercases code', async () => {
      (Voucher.create as any).mockResolvedValue({ code: 'MYCODE' });
      await VoucherService.create({ code: 'mycode', type: 'fixed', value: 10000, startDate: '2025-01-01', endDate: '2025-12-31' });
      expect(Voucher.create).toHaveBeenCalledWith(expect.objectContaining({ code: 'MYCODE' }));
    });
  });

  describe('delete', () => {
    it('returns true when deleted', async () => {
      (Voucher.deleteOne as any).mockResolvedValue({ deletedCount: 1 });
      expect(await VoucherService.delete('v1')).toBe(true);
    });

    it('returns false when not found', async () => {
      (Voucher.deleteOne as any).mockResolvedValue({ deletedCount: 0 });
      expect(await VoucherService.delete('v1')).toBe(false);
    });
  });
});
