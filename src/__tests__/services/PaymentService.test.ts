import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/Payment.ts', () => {
  const mock = {
    find: vi.fn().mockReturnThis(),
    findOne: vi.fn().mockReturnThis(),
    create: vi.fn(),
    deleteOne: vi.fn(),
    sort: vi.fn().mockReturnThis(),
    populate: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue([]),
  };
  return {
    Payment: { ...mock, findOneAndUpdate: vi.fn() },
    PaymentStatus: {},
  };
});

vi.mock('../../models/PaymentMethod.ts', () => {
  const mock = {
    find: vi.fn().mockReturnThis(),
    findOne: vi.fn().mockReturnThis(),
    create: vi.fn(),
    deleteOne: vi.fn(),
    sort: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue([]),
  };
  return {
    PaymentMethod: { ...mock, findOneAndUpdate: vi.fn() },
  };
});

import { PaymentService, PaymentMethodService } from '../../services/PaymentService.ts';
import { Payment } from '../../models/Payment.ts';
import { PaymentMethod } from '../../models/PaymentMethod.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PaymentMethodService', () => {
  it('getAll returns all methods', async () => {
    (PaymentMethod.find as any).mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([{ name: 'COD' }]) }) });
    const result = await PaymentMethodService.getAll();
    expect(PaymentMethod.find).toHaveBeenCalledWith({});
  });

  it('getAll with onlyActive filters isActive', async () => {
    (PaymentMethod.find as any).mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([]) }) });
    await PaymentMethodService.getAll(true);
    expect(PaymentMethod.find).toHaveBeenCalledWith({ isActive: true });
  });

  it('create calls PaymentMethod.create', async () => {
    (PaymentMethod.create as any).mockResolvedValue({ name: 'COD', code: 'cod' });
    const result = await PaymentMethodService.create({ name: 'COD', code: 'cod' });
    expect(PaymentMethod.create).toHaveBeenCalled();
    expect(result.name).toBe('COD');
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

describe('PaymentService', () => {
  it('getAll calls find with populate and sort', async () => {
    const chain = { populate: vi.fn().mockReturnThis(), sort: vi.fn().mockReturnThis(), lean: vi.fn().mockResolvedValue([]) };
    (Payment.find as any).mockReturnValue(chain);
    await PaymentService.getAll();
    expect(Payment.find).toHaveBeenCalled();
    expect(chain.populate).toHaveBeenCalled();
  });

  it('create resolves method code to PaymentMethod', async () => {
    (PaymentMethod.findOne as any).mockReturnValue({ lean: () => Promise.resolve({ _id: 'pm1' }) });
    (Payment.create as any).mockResolvedValue({ orderId: 'o1', method: 'cod' });
    await PaymentService.create({ orderId: 'o1', method: 'cod' });
    expect(PaymentMethod.findOne).toHaveBeenCalledWith({ code: 'cod' });
  });

  it('delete returns true when deleted', async () => {
    (Payment.deleteOne as any).mockResolvedValue({ deletedCount: 1 });
    expect(await PaymentService.delete('p1')).toBe(true);
  });

  it('delete returns false when not found', async () => {
    (Payment.deleteOne as any).mockResolvedValue({ deletedCount: 0 });
    expect(await PaymentService.delete('p1')).toBe(false);
  });
});
