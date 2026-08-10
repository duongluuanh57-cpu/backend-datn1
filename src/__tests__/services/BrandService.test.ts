import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/Brand.ts', () => {
  const chain: any = {
    find: vi.fn().mockReturnThis(),
    findOne: vi.fn().mockReturnThis(),
    create: vi.fn(),
    deleteOne: vi.fn(),
    deleteMany: vi.fn(),
    countDocuments: vi.fn(),
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue([]),
    distinct: vi.fn().mockResolvedValue([]),
    findOneAndUpdate: vi.fn(),
  };
  const BrandMock: any = vi.fn().mockImplementation(function (this: any) {
    Object.assign(this, chain);
  });
  Object.assign(BrandMock, chain);
  return { Brand: BrandMock, IBrand: {} };
});

vi.mock('../../services/ImageService.ts', () => ({
  ImageService: { deleteFromR2: vi.fn().mockResolvedValue(undefined) },
}));

import { BrandService } from '../../services/BrandService.ts';
import { Brand } from '../../models/Brand.ts';
import { ImageService } from '../../services/ImageService.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BrandService', () => {
  it('getAllBrands sorts by name', async () => {
    (Brand.find as any).mockReturnValue({ sort: () => Promise.resolve([{ name: 'A' }]) });
    const result = await BrandService.getAllBrands();
    expect(Brand.find).toHaveBeenCalledWith({});
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
    const result = await BrandService.getBrandById('b1');
    expect(Brand.findOne).toHaveBeenCalledWith({ _id: 'b1' });
  });

  it('createBrand saves new brand', async () => {
    const saveSpy = vi.fn().mockResolvedValue({ name: 'New' });
    (Brand as any).mockImplementation(function (this: any) { this.save = saveSpy; });
    await BrandService.createBrand({ name: 'New' });
    expect(saveSpy).toHaveBeenCalled();
  });

  it('deleteBrand returns false when not found', async () => {
    (Brand.findOne as any).mockResolvedValue(null);
    expect(await BrandService.deleteBrand('x1')).toBe(false);
  });

  it('deleteBrand returns true and cleans R2 when deleted', async () => {
    (Brand.findOne as any).mockResolvedValue({ _id: 'b1', logo: 'https://r2/logo.png' });
    (Brand.deleteOne as any).mockResolvedValue({ deletedCount: 1 });
    expect(await BrandService.deleteBrand('b1')).toBe(true);
    // R2 cleanup is fire-and-forget, check it was called
    await new Promise(r => setTimeout(r, 10));
    expect(ImageService.deleteFromR2).toHaveBeenCalledWith('https://r2/logo.png');
  });

  it('bulkDeleteBrands returns false for empty array', async () => {
    expect(await BrandService.bulkDeleteBrands([])).toBe(false);
  });

  it('bulkDeleteBrands deletes and cleans logos', async () => {
    (Brand.find as any).mockResolvedValue([{ logo: 'l1' }, { logo: null }]);
    (Brand.deleteMany as any).mockResolvedValue({ deletedCount: 2 });
    expect(await BrandService.bulkDeleteBrands(['b1', 'b2'])).toBe(true);
  });

  it('getBrandOrigins returns sorted distinct origins', async () => {
    (Brand.find as any).mockReturnValue({ distinct: () => Promise.resolve(['France', null, 'Italy', '']) });
    const result = await BrandService.getBrandOrigins();
    expect(result).toEqual(['France', 'Italy']);
  });
});
