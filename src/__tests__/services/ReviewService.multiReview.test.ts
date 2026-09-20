import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

const oid = () => new mongoose.Types.ObjectId();

vi.mock('../../models/Review.ts', () => ({
  ASPECT_OPTIONS: { quality: 'Chất lượng', longevity: 'Độ lưu hương', scent: 'Mùi hương', value: 'Giá trị', packaging: 'Bao bì', other: 'Khác' },
  Review: {
    find: vi.fn(),
    findOne: vi.fn(),
    findById: vi.fn(),
    countDocuments: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
  },
}));
vi.mock('../../models/Product.ts', () => ({
  Product: { findByIdAndUpdate: vi.fn().mockResolvedValue({}) },
}));
vi.mock('../../models/OrderItem.ts', () => ({
  OrderItem: { find: vi.fn(), findOne: vi.fn() },
}));
vi.mock('../../models/Order.ts', () => ({
  Order: { find: vi.fn() },
}));
vi.mock('../../models/User.ts', () => ({ User: {} }));
vi.mock('../../services/ai/aiModerationService.ts', () => ({
  moderateContent: vi.fn().mockResolvedValue({ isAppropriate: true }),
  LOCKED_MODERATION_CATEGORIES: [],
}));

import { ReviewService } from '../../services/ReviewService.ts';
import { Review } from '../../models/Review.ts';
import { Order } from '../../models/Order.ts';
import { OrderItem } from '../../models/OrderItem.ts';

const userId = oid().toString();
const productId = oid().toString();

beforeEach(() => {
  vi.clearAllMocks();
  (Review.countDocuments as any).mockResolvedValue(0);
});

describe('ReviewService.canReview — 1 lượt mua = 1 review', () => {
  it('mua 2 lần, đã review 1 lần (visible) → vẫn còn 1 lượt', async () => {
    (Order.find as any).mockReturnValue({ lean: async () => [{ _id: oid() }, { _id: oid() }] });
    (OrderItem.find as any).mockReturnValue({ lean: async () => [{ _id: oid() }, { _id: oid() }] });
    (Review.countDocuments as any).mockResolvedValue(1);

    const res = await ReviewService.canReview(userId, productId);
    expect(res.purchasedCount).toBe(2);
    expect(res.reviewedCount).toBe(1);
    expect(res.canReview).toBe(true);
  });

  it('review bị REJECTED không mất lượt — được viết lại', async () => {
    (Order.find as any).mockReturnValue({ lean: async () => [{ _id: oid() }] });
    (OrderItem.find as any).mockReturnValue({ lean: async () => [{ _id: oid() }] });
    (Review.countDocuments as any).mockResolvedValue(0); // chỉ đếm visible/pending

    const res = await ReviewService.canReview(userId, productId);
    // Regression: query phải lọc status visible/pending
    const filter = (Review.countDocuments as any).mock.calls[0][0];
    expect(filter.status).toEqual({ $in: ['visible', 'pending'] });
    expect(res.canReview).toBe(true);
  });

  it('mua 1 lần, review 1 lần → hết lượt', async () => {
    (Order.find as any).mockReturnValue({ lean: async () => [{ _id: oid() }] });
    (OrderItem.find as any).mockReturnValue({ lean: async () => [{ _id: oid() }] });
    (Review.countDocuments as any).mockResolvedValue(1);

    const res = await ReviewService.canReview(userId, productId);
    expect(res.canReview).toBe(false);
  });
});

describe('ReviewService.create — ghép review với OrderItem chưa có review', () => {
  it('tự tìm orderItem còn trống khi client không gửi orderItemId', async () => {
    const freeItem = { _id: oid() };
    (Order.find as any).mockImplementation(() => ({
      lean: async () => [{ _id: oid() }],
      select: () => ({ lean: async () => [{ _id: oid() }] }),
    }));
    (Review.find as any).mockImplementation((_q: any, select?: string) => ({
      select: () => ({
        lean: async () => (select && String(select).includes('orderItemId') ? [] : []),
      }),
      lean: async () => [],
    }));
    (OrderItem.findOne as any).mockReturnValue({ select: () => ({ lean: async () => freeItem }) });
    (Review.create as any).mockResolvedValue({ _id: oid(), status: 'pending', save: vi.fn().mockResolvedValue({}) });

    await ReviewService.create(userId, { productId, rating: 5 });

    const created = (Review.create as any).mock.calls[0][0];
    expect(created.orderItemId?.toString()).toBe(freeItem._id.toString());
  });

  it('không dùng lại orderItem đã có review (mua lại 2 lần)', async () => {
    const usedItem = oid().toString();
    const freshItem = { _id: oid() };
    (Order.find as any).mockImplementation(() => ({
      lean: async () => [{ _id: oid() }, { _id: oid() }],
      select: () => ({ lean: async () => [{ _id: oid() }, { _id: oid() }] }),
    }));
    (Review.find as any).mockImplementation(() => ({
      select: (sel: string) => {
        const rows = sel && sel.includes('orderItemId') ? [{ orderItemId: usedItem }] : [];
        return { lean: async () => rows };
      },
      lean: async () => [],
    }));
    (OrderItem.findOne as any).mockReturnValue({ select: () => ({ lean: async () => freshItem }) });
    (Review.create as any).mockResolvedValue({ _id: oid(), status: 'pending', save: vi.fn().mockResolvedValue({}) });

    await ReviewService.create(userId, { productId, rating: 4 });

    const oneFilter = (OrderItem.findOne as any).mock.calls[0][0];
    expect(oneFilter._id.$nin.map((s: any) => s.toString())).toContain(usedItem);
    const created = (Review.create as any).mock.calls[0][0];
    expect(created.orderItemId?.toString()).toBe(freshItem._id.toString());
  });
});
