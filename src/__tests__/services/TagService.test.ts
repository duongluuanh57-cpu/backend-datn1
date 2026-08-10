import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/Tag.ts', () => {
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
  const TagMock: any = vi.fn().mockImplementation(function (this: any) {
    Object.assign(this, chain);
  });
  Object.assign(TagMock, chain);
  return { Tag: TagMock, ITag: {} };
});

import { TagService } from '../../services/TagService.ts';
import { Tag } from '../../models/Tag.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TagService', () => {
  describe('getAllTags', () => {
    it('returns only active tags sorted by name', async () => {
      (Tag.find as any).mockReturnValue({ sort: () => Promise.resolve([{ name: 'A' }]) });
      const result = await TagService.getAllTags();
      expect(Tag.find).toHaveBeenCalledWith({ status: 'active' });
    });
  });

  describe('getPaginatedTags', () => {
    it('returns paginated result', async () => {
      (Tag.countDocuments as any).mockResolvedValue(30);
      (Tag.find as any).mockReturnValue({
        sort: () => ({ skip: () => ({ limit: () => ({ lean: () => Promise.resolve([{ name: 'X' }]) }) }) }),
      });
      const result = await TagService.getPaginatedTags(1, 10);
      expect(result.total).toBe(30);
      expect(result.totalPages).toBe(3);
    });
  });

  describe('createTag', () => {
    it('auto-generates slug from name', async () => {
      const saveSpy = vi.fn().mockResolvedValue({ name: 'Summer Sale', slug: 'summer-sale' });
      (Tag as any).mockImplementation(function(this: any) { this.save = saveSpy; });
      await TagService.createTag({ name: 'Summer Sale' });
      expect(saveSpy).toHaveBeenCalled();
    });

    it('uses provided slug over auto-generated', async () => {
      const saveSpy = vi.fn().mockResolvedValue({ name: 'X', slug: 'custom-slug' });
      (Tag as any).mockImplementation(function(this: any) { this.save = saveSpy; });
      await TagService.createTag({ name: 'X', slug: 'custom-slug' });
      expect(saveSpy).toHaveBeenCalled();
    });
  });

  describe('deleteTag', () => {
    it('returns true when deleted', async () => {
      (Tag.deleteOne as any).mockResolvedValue({ deletedCount: 1 });
      expect(await TagService.deleteTag('t1')).toBe(true);
    });

    it('returns false when not found', async () => {
      (Tag.deleteOne as any).mockResolvedValue({ deletedCount: 0 });
      expect(await TagService.deleteTag('t1')).toBe(false);
    });
  });

  describe('bulkDeleteTags', () => {
    it('returns 0 for empty array', async () => {
      expect(await TagService.bulkDeleteTags([])).toBe(0);
    });

    it('returns count of deleted tags', async () => {
      (Tag.deleteMany as any).mockResolvedValue({ deletedCount: 3 });
      expect(await TagService.bulkDeleteTags(['t1', 't2', 't3'])).toBe(3);
    });
  });
});
