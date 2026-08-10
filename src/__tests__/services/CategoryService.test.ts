import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/Category.ts', () => {
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
    findOneAndUpdate: vi.fn(),
  };
  const CategoryMock: any = vi.fn().mockImplementation(function (this: any) {
    Object.assign(this, chain);
  });
  Object.assign(CategoryMock, chain);
  return { Category: CategoryMock };
});

vi.mock('../../models/Product.ts', () => ({
  Product: { countDocuments: vi.fn().mockResolvedValue(0) },
}));

import { CategoryService } from '../../services/CategoryService.ts';
import { Category } from '../../models/Category.ts';
import { Product } from '../../models/Product.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CategoryService', () => {
  describe('create', () => {
    it('generates slug from name', async () => {
      (Category.findOne as any).mockReturnValue({ sort: () => ({ lean: () => Promise.resolve(null) }) });
      const saveSpy = vi.fn().mockResolvedValue({ name: 'Test', slug: 'test' });
      (Category as any).mockImplementation(function (this: any) { this.save = saveSpy; });
      await CategoryService.create({ name: 'Test' });
      expect(saveSpy).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('throws when products are using the category', async () => {
      (Product.countDocuments as any).mockResolvedValue(5);
      await expect(CategoryService.delete('c1')).rejects.toThrow('Không thể xoá');
    });

    it('deletes when no products use it', async () => {
      (Product.countDocuments as any).mockResolvedValue(0);
      (Category.deleteOne as any).mockResolvedValue({ deletedCount: 1 });
      expect(await CategoryService.delete('c1')).toBe(true);
    });
  });

  describe('bulkDelete', () => {
    it('returns false for empty array', async () => {
      expect(await CategoryService.bulkDelete([])).toBe(false);
    });

    it('throws when products use any of the categories', async () => {
      (Product.countDocuments as any).mockResolvedValue(3);
      await expect(CategoryService.bulkDelete(['c1', 'c2'])).rejects.toThrow('Không thể xoá');
    });
  });

  describe('getPaginatedCategories', () => {
    it('returns items with pagination', async () => {
      (Category.countDocuments as any).mockResolvedValue(20);
      (Category.find as any).mockReturnValue({
        sort: () => ({ skip: () => ({ limit: () => ({ lean: () => Promise.resolve([{ name: 'X' }]) }) }) }),
      });
      const result = await CategoryService.getPaginatedCategories({ page: 2, limit: 5 });
      expect(result.total).toBe(20);
      expect(result.totalPages).toBe(4);
    });
  });
});
