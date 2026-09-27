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

vi.mock('../../config/redis.ts', () => ({
  redis: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn().mockResolvedValue(1) },
}));

import { CategoryService } from '../../services/CategoryService.ts';
import { Category } from '../../models/Category.ts';
import { Product } from '../../models/Product.ts';

const slugAvailable = () =>
  (Category.findOne as any).mockReturnValue({ lean: () => Promise.resolve(null) });

beforeEach(() => {
  vi.clearAllMocks();
  (Product.countDocuments as any).mockResolvedValue(0);
});

describe('CategoryService', () => {
  describe('create', () => {
    it('derives slug from name when no slug is provided', async () => {
      slugAvailable();
      const saveSpy = vi.fn().mockResolvedValue({ name: 'Test', slug: 'test' });
      (Category as any).mockImplementation(function (this: any) { this.save = saveSpy; });
      await CategoryService.create({ name: 'Test' });
      expect(saveSpy).toHaveBeenCalled();
    });

    it('honors a custom slug from the client', async () => {
      slugAvailable();
      let captured: any;
      (Category as any).mockImplementation(function (this: any, data: any) {
        captured = data;
        this.save = vi.fn().mockResolvedValue(data);
      });
      await CategoryService.create({ name: 'Nước Hoa', slug: 'custom-slug' });
      expect(captured.slug).toBe('custom-slug');
    });

    it('rejects a duplicate slug with statusCode 409', async () => {
      (Category.findOne as any).mockReturnValue({ lean: () => Promise.resolve({ _id: 'x', slug: 'test' }) });
      await expect(CategoryService.create({ name: 'Test' })).rejects.toMatchObject({ statusCode: 409 });
    });
  });

  describe('update', () => {
    it('recomputes slug from name only when no custom slug is sent', async () => {
      slugAvailable();
      (Category.findOneAndUpdate as any).mockReturnValue({ lean: () => Promise.resolve({ _id: 'c1' }) });
      await CategoryService.update('c1', { name: 'Cham Soc Da' });
      const setArg = (Category.findOneAndUpdate as any).mock.calls[0][1];
      expect(setArg.$set.slug).toBe('cham-soc-da');
    });
  });

  describe('delete', () => {
    it('throws with statusCode 409 when products are using the category', async () => {
      (Product.countDocuments as any).mockResolvedValue(5);
      await expect(CategoryService.delete('c1')).rejects.toMatchObject({ statusCode: 409 });
      await expect(CategoryService.delete('c1')).rejects.toThrow('Không thể xoá');
    });

    it('deletes when no products use it', async () => {
      (Product.countDocuments as any).mockResolvedValue(0);
      (Category.deleteOne as any).mockResolvedValue({ deletedCount: 1 });
      expect(await CategoryService.delete('c1')).toBe(true);
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
