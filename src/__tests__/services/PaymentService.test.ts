import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/PaymentMethod.ts', () => {
  const mock = {
    find: vi.fn().mockReturnThis(),
    findOne: vi.fn().mockReturnThis(),
    create: vi.fn(),
    findOneAndUpdate: vi.fn(),
    deleteOne: vi.fn(),
    sort: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue([]),
  };
  return { PaymentMethod: mock };
});

import { PaymentMethodService } from '../../services/PaymentService.ts';
import { PaymentMethod } from '../../models/PaymentMethod.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

// Bảng `payments` (giao dịch) đã bị xoá → chỉ còn danh mục phương thức thanh toán.
describe('PaymentMethodService', () => {
  it('getAll returns all methods', async () => {
    (PaymentMethod.find as any).mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([{ name: 'COD' }]) }) });
    const result = await PaymentMethodService.getAll();
    expect(PaymentMethod.find).toHaveBeenCalledWith({});
    expect(result).toEqual([{ name: 'COD' }]);
  });

  it('getAll with onlyActive filters status active', async () => {
    (PaymentMethod.find as any).mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([]) }) });
    await PaymentMethodService.getAll(true);
    expect(PaymentMethod.find).toHaveBeenCalledWith({ status: 'active' });
  });

  it('create calls PaymentMethod.create', async () => {
    (PaymentMethod.create as any).mockResolvedValue({ name: 'COD', code: 'cod' });
    const result = await PaymentMethodService.create({ name: 'COD', code: 'cod' });
    expect(PaymentMethod.create).toHaveBeenCalled();
    expect(result.name).toBe('COD');
  });

  it('update sets status thay cho isActive cũ', async () => {
    (PaymentMethod.findOneAndUpdate as any).mockReturnValue({ lean: () => Promise.resolve({ code: 'cod', status: 'inactive' }) });
    const updated = await PaymentMethodService.update('pm1', { status: 'inactive' });
    expect(PaymentMethod.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'pm1' },
      { $set: { status: 'inactive' } },
      { new: true }
    );
    expect(updated.status).toBe('inactive');
  });

  it('delete returns true when deleted', async () => {
    (PaymentMethod.deleteOne as any).mockResolvedValue({ deletedCount: 1 });
    expect(await PaymentMethodService.delete('id1')).toBe(true);
  });

  it('delete returns false when not found', async () => {
    (PaymentMethod.deleteOne as any).mockResolvedValue({ deletedCount: 0 });
    expect(await PaymentMethodService.delete('id1')).toBe(false);
  });
});
