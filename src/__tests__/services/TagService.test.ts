import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/Tag.ts', () => {
  const chain: any = {
    find: vi.fn().mockReturnThis(),
    findOne: vi.fn().mockReturnThis(),
    countDocuments: vi.fn(),
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue([]),
    findOneAndUpdate: vi.fn(),
  };
  const TagMock: any = vi.fn();
  Object.assign(TagMock, chain);
  return { Tag: TagMock, ITag: {} };
});

vi.mock('../../models/ProductTag.ts', () => ({
  ProductTag: {
    aggregate: vi.fn().mockResolvedValue([]),
    countDocuments: vi.fn().mockResolvedValue(0),
    find: vi.fn().mockReturnValue({
      populate: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          skip: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
          }),
        }),
      }),
    }),
  },
}));

vi.mock('../../services/FlashSaleService.ts', () => ({
  FlashSaleService: {
    clearCache: vi.fn().mockResolvedValue(undefined),
  },
}));

import { TagService } from '../../services/TagService.ts';
import { Tag } from '../../models/Tag.ts';
import { FlashSaleService } from '../../services/FlashSaleService.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TagService', () => {
  it('returns only active tags sorted by name', async () => {
    (Tag.find as any).mockReturnValue({ sort: () => Promise.resolve([{ name: 'A' }]) });
    await TagService.getAllTags();
    expect(Tag.find).toHaveBeenCalledWith({ status: 'active' });
  });

  it('returns paginated result', async () => {
    (Tag.countDocuments as any).mockResolvedValue(30);
    (Tag.find as any).mockReturnValue({
      sort: () => ({ skip: () => ({ limit: () => ({ lean: () => Promise.resolve([{ name: 'X' }]) }) }) }),
    });
    const result = await TagService.getPaginatedTags(1, 10);
    expect(result.total).toBe(30);
    expect(result.totalPages).toBe(3);
  });

  it('only updates tag status', async () => {
    (Tag.findOneAndUpdate as any).mockResolvedValue({ _id: 't1', name: 'Limited', status: 'inactive' });
    const result = await TagService.updateTagStatus('t1', 'inactive');

    expect(Tag.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 't1' },
      { $set: { status: 'inactive' } },
      { new: true }
    );
    expect(result?.status).toBe('inactive');
    expect(FlashSaleService.clearCache).toHaveBeenCalled();
  });

  it('returns null when the tag does not exist', async () => {
    (Tag.findOneAndUpdate as any).mockResolvedValue(null);
    await expect(TagService.updateTagStatus('missing', 'active')).resolves.toBeNull();
    expect(FlashSaleService.clearCache).not.toHaveBeenCalled();
  });
});
