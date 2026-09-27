import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/Brand.ts', () => {
  const chain: any = {
    find: vi.fn().mockReturnThis(),
    findOne: vi.fn().mockReturnThis(),
    countDocuments: vi.fn(),
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue([]),
    distinct: vi.fn().mockResolvedValue([]),
    findOneAndUpdate: vi.fn(),
  };
  const BrandMock: any = vi.fn();
  Object.assign(BrandMock, chain);
  return { Brand: BrandMock, IBrand: {} };
});

vi.mock('../../models/Product.ts', () => ({
  Product: {
    aggregate: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../config/redis.ts', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    scan: vi.fn().mockResolvedValue(['0', ['homepage:v18']]),
  },
}));

vi.mock('../../graphql/schema.ts', () => ({
  invalidateHomepageCache: vi.fn(),
}));

import { BrandService } from '../../services/BrandService.ts';
import { Brand } from '../../models/Brand.ts';
import { redis } from '../../config/redis.ts';
import { invalidateHomepageCache } from '../../graphql/schema.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BrandService', () => {
  it('returns only active brands from the public cache', async () => {
    (Brand.find as any).mockReturnValue({ sort: () => Promise.resolve([{ name: 'A' }]) });
    await BrandService.getAllBrands();
    expect(Brand.find).toHaveBeenCalledWith({ status: 'active' });
  });

  it('getPaginatedBrands returns items with pagination', async () => {
    (Brand.countDocuments as any).mockResolvedValue(25);
    (Brand.find as any).mockReturnValue({
      sort: () => ({ skip: () => ({ limit: () => ({ lean: () => Promise.resolve([{ name: 'X' }]) }) }) }),
    });
    const result = await BrandService.getPaginatedBrands({ page: 1, limit: 10 });
    expect(result.total).toBe(25);
    expect(result.totalPages).toBe(3);
  });

  it('getBrandById delegates to findOne', async () => {
    (Brand.findOne as any).mockReturnValue({ lean: () => Promise.resolve({ name: 'Dior' }) });
    await BrandService.getBrandById('b1');
    expect(Brand.findOne).toHaveBeenCalledWith({ _id: 'b1' });
  });

  it('only updates brand status', async () => {
    (Brand.findOneAndUpdate as any).mockResolvedValue({ _id: 'b1', name: 'Dior', status: 'inactive' });
    const result = await BrandService.updateBrandStatus('b1', 'inactive');

    expect(Brand.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'b1' },
      { $set: { status: 'inactive' } },
      { new: true }
    );
    expect(result?.status).toBe('inactive');
    // Quét cache trang chủ theo pattern + xóa cache danh sách brand
    expect(redis.scan).toHaveBeenCalledWith('0', 'MATCH', 'homepage:*', 'COUNT', 200);
    expect(redis.del).toHaveBeenCalledWith('brands:all', 'brands:all:active:v1', 'homepage:v18');
    // Hủy cả tầng cache in-memory của trang chủ
    expect(invalidateHomepageCache).toHaveBeenCalled();
  });

  it('returns null when the brand does not exist', async () => {
    (Brand.findOneAndUpdate as any).mockResolvedValue(null);
    await expect(BrandService.updateBrandStatus('missing', 'active')).resolves.toBeNull();
  });
});
