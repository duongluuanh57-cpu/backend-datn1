import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

const oid = () => new mongoose.Types.ObjectId();

vi.mock('../../models/Review.ts', () => ({
  Review: {
    find: vi.fn(),
    findOne: vi.fn(),
    findById: vi.fn(),
    findOneAndUpdate: vi.fn(),
    countDocuments: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
  },
}));
vi.mock('../../models/Product.ts', () => ({
  Product: { findByIdAndUpdate: vi.fn().mockResolvedValue({}) },
}));
vi.mock('../../models/ProductVariant.ts', () => ({
  ProductVariant: { find: vi.fn() },
}));
vi.mock('../../models/OrderItem.ts', () => ({
  OrderItem: { find: vi.fn(), findOne: vi.fn() },
}));
vi.mock('../../models/Order.ts', () => ({
  Order: { find: vi.fn() },
}));
vi.mock('../../models/User.ts', () => ({ User: {} }));
vi.mock('../../services/ai/aiModerationService.ts', () => ({
  moderateContent: vi.fn().mockResolvedValue({ isAppropriate: true, category: 'none', checked: true }),
}));

import { ReviewService } from '../../services/ReviewService.ts';
import { Review } from '../../models/Review.ts';
import { Order } from '../../models/Order.ts';
import { OrderItem } from '../../models/OrderItem.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { moderateContent } from '../../services/ai/aiModerationService.ts';

const userId = oid().toString();
const productId = oid().toString();

beforeEach(() => {
  vi.clearAllMocks();
  (ProductVariant.find as any).mockReturnValue({ select: () => ({ lean: async () => [{ _id: oid() }] }) });
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

  it('review REJECTED không mất lượt; visible/pending vẫn mất lượt', async () => {
    (Order.find as any).mockReturnValue({ lean: async () => [{ _id: oid() }] });
    (OrderItem.find as any).mockReturnValue({ lean: async () => [{ _id: oid() }] });
    (Review.countDocuments as any).mockResolvedValue(0);

    const res = await ReviewService.canReview(userId, productId);
    // Regression: 'pending' (AI gián đoạn, đang chờ admin) PHẢI tính vào hạn — nếu không thì
    // trong lúc AI sập một user spam được vô hạn review. 'rejected' thì không.
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

describe('ReviewService.create — simplified (no orderItemId/aspects)', () => {
  it('create với rating/comment cơ bản', async () => {
    (Review.countDocuments as any).mockResolvedValue(0);

    (Review.create as any).mockResolvedValue({
      _id: oid(),
      status: 'pending',
      save: vi.fn().mockResolvedValue({}),
      productId: new mongoose.Types.ObjectId(productId),
    });

    await ReviewService.create(userId, {
      productId,
      rating: 5,
      comment: 'test comment',
      images: ['img1'],
      isAnonymous: true,
    });

    const created = (Review.create as any).mock.calls[0][0];
    expect(created.productId?.toString()).toBe(productId);
    expect(created.rating).toBe(5);
    expect(created.comment).toBe('test comment');
    expect(created.images).toEqual(['img1']);
    expect(created.isAnonymous).toBe(true);
    expect(created).not.toHaveProperty('orderItemId');
    expect(created).not.toHaveProperty('aspects');
  });

  it('AI từ chối → ghi luôn status rejected + aiRejected, không để pending', async () => {
    (Review.countDocuments as any).mockResolvedValue(0);
    (Review.create as any).mockResolvedValue({ _id: oid() });
    vi.mocked(moderateContent).mockResolvedValueOnce({
      isAppropriate: false,
      reason: 'Ngôn từ thù ghét',
      category: 'hate',
      checked: true,
    });

    await ReviewService.create(userId, { productId, rating: 1, comment: 'Nội dung vi phạm' });

    const created = (Review.create as any).mock.calls[0][0];
    expect(created.status).toBe('rejected');
    expect(created.aiRejected).toBe(true);
    expect(created.rejectionReason).toBe('Ngôn từ thù ghét');
    expect(created.moderatedByType).toBe('ai');
  });

  // AI bất lực != nội dung hợp lệ, nhưng cũng không được chặn user: rơi vào hàng đợi admin.
  it('AI không kiểm được → tạo review pending cho admin duyệt tay, không 503', async () => {
    (Review.countDocuments as any).mockResolvedValue(0);
    (Review.create as any).mockResolvedValue({ _id: oid() });
    vi.mocked(moderateContent).mockResolvedValueOnce({
      isAppropriate: true,
      category: 'none',
      checked: false,
    });

    await ReviewService.create(userId, { productId, rating: 5, comment: 'abc' });

    const created = (Review.create as any).mock.calls[0][0];
    expect(created.status).toBe('pending');
    // Chưa có phán quyết nào thì không được ghi công cho AI
    expect(created.moderatedBy).toBe('');
    expect(created.moderatedByType).toBe('');
    expect(created.aiRejected).toBe(false);
  });

  it('mọi đường đều ghi review đúng 1 lần (không create rồi save)', async () => {
    (Review.countDocuments as any).mockResolvedValue(0);
    (Review.create as any).mockResolvedValue({ _id: oid() });

    await ReviewService.create(userId, { productId, rating: 5, comment: 'abc' });

    expect(Review.create).toHaveBeenCalledTimes(1);
  });

  it('không có comment → bỏ qua AI, visible ngay', async () => {
    (Review.countDocuments as any).mockResolvedValue(0);
    (Review.create as any).mockResolvedValue({ _id: oid() });

    await ReviewService.create(userId, { productId, rating: 4 });

    expect(moderateContent).not.toHaveBeenCalled();
    expect((Review.create as any).mock.calls[0][0].status).toBe('visible');
  });
});

describe('ReviewService.moderate — lưới chắn cuối cho hàng đợi pending', () => {
  const pendingId = oid().toString();
  const chainable = () => {
    const q: any = { populate: () => q, lean: async () => q._result };
    return q;
  };

  it('chỉ update review đang pending và ghi nhận tên admin', async () => {
    const doc = chainable();
    doc._result = { _id: pendingId, status: 'visible', moderatedByType: 'admin' };
    (Review.findOneAndUpdate as any).mockReturnValue(doc);

    await ReviewService.moderate(pendingId, 'visible', 'Admin Kiên');

    const [filter, update] = (Review.findOneAndUpdate as any).mock.calls[0];
    expect(filter.status).toBe('pending');
    expect(update.$set).toEqual({ status: 'visible', moderatedBy: 'Admin Kiên', moderatedByType: 'admin' });
  });

  it('review AI đã phán quyết (không còn pending) → 400, không cho admin sửa', async () => {
    const doc = chainable();
    doc._result = null; // filter { _id, status: 'pending' } không match
    (Review.findOneAndUpdate as any).mockReturnValue(doc);

    await expect(ReviewService.moderate(pendingId, 'rejected', 'Admin Kiên'))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});
