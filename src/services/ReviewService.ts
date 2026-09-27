import mongoose from 'mongoose';
import { Review } from '../models/Review.ts';
import { Product } from '../models/Product.ts';
import { ProductVariant } from '../models/ProductVariant.ts';
import { OrderItem } from '../models/OrderItem.ts';
import { Order } from '../models/Order.ts';
import { User } from '../models/User.ts';
import { moderateContent } from './ai/aiModerationService.ts';
import { AppError } from '../utils/errors.ts';

export class ReviewService {
  static async canReview(
    userId: string,
    productId: string
  ): Promise<{ canReview: boolean; purchasedCount: number; reviewedCount: number }> {
    const pid = new mongoose.Types.ObjectId(productId);
    const uid = new mongoose.Types.ObjectId(userId);

    const [deliveredOrders, reviewedCount] = await Promise.all([
      Order.find({ userId: uid, status: 'delivered' }).lean(),
      // Chỉ đếm review HIỂN THỊ. Review rejected không mất lượt — user được viết lại.
      // Review 'pending' (chỉ còn trong dữ liệu cũ, luồng create giờ không sinh ra nữa) cũng
      // không mất lượt: không admin nào duyệt được nữa nên đó là ngõ cụt, chặn user mãi là bug.
      // Đếm review đang hiệu lực (visible) + review chờ admin duyệt (pending — chỉ sinh ra
      // khi AI không kiểm được). Pending phải tính vào hạn, nếu không thì lúc AI sập một user
      // spam được vô hạn review. Review rejected không mất lượt — user được viết lại.
      Review.countDocuments({ userId: uid, productId: pid, status: { $in: ['visible', 'pending'] } }),
    ]);

    const orderIds = deliveredOrders.map((o) => o._id);
    const variantIds = await ProductVariant.find({ productId: pid }).select('_id').lean();
    const orderItems = await OrderItem.find({
      orderId: { $in: orderIds },
      productVariantId: { $in: variantIds.map((variant) => variant._id) },
    })
      .lean();

    const purchasedCount = orderItems.length;

    return {
      canReview: purchasedCount > reviewedCount,
      purchasedCount,
      reviewedCount,
    };
  }

  static async getByProduct(
    productId: string,
    page = 1,
    limit = 10,
    currentUserId?: string,
    rating?: number,
    hasImages?: boolean,
    hasComment?: boolean
  ) {
    const skip = (page - 1) * limit;
    const query: Record<string, any> = {
      productId: new mongoose.Types.ObjectId(productId),
    };

    if (currentUserId) {
      // Chủ review còn xem được review của chính mình đang chờ admin duyệt hoặc bị AI từ chối
      // (để biết lý do). Người khác chỉ thấy 'visible'.
      query.$or = [
        { status: 'visible' },
        { userId: new mongoose.Types.ObjectId(currentUserId), status: { $in: ['rejected', 'pending'] } }
      ];
    } else {
      query.status = 'visible';
    }

    if (rating && rating >= 1 && rating <= 5) {
      query.rating = rating;
    }

    if (hasImages) {
      query.images = { $exists: true, $not: { $size: 0 } };
    }

    if (hasComment) {
      query.comment = { $exists: true, $ne: '' };
    }

    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate('userId', 'fullName username avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Review.countDocuments(query),
    ]);

    return { reviews, total, page, totalPages: Math.ceil(total / limit) };
  }

  static async getStats(productId: string) {
    const reviews = await Review.find(
      { productId: new mongoose.Types.ObjectId(productId), status: 'visible' },
      'rating'
    ).lean();

    if (!reviews.length) {
      return {
        avgRating: 0,
        total: 0,
        distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      };
    }

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalRating = 0;

    for (const r of reviews) {
      const rating = r.rating ?? 0;
      if (rating >= 1 && rating <= 5) {
        distribution[rating] += 1;
        totalRating += rating;
      }
    }

    return {
      avgRating: Math.round((totalRating / reviews.length) * 10) / 10,
      total: reviews.length,
      distribution,
    };
  }

  static async create(
    userId: string,
    data: {
      productId: string;
      rating: number;
      comment?: string;
      images?: string[];
      isAnonymous?: boolean;
    }
  ) {
    // Mandatory purchase verification
    const { canReview, purchasedCount } = await ReviewService.canReview(
      userId,
      data.productId
    );
    if (!canReview) {
      if (purchasedCount === 0) {
        throw new AppError('Bạn cần mua sản phẩm này để đánh giá', 400);
      }
      throw new AppError('Bạn đã đánh giá hết lượt mua. Vui lòng mua thêm để đánh giá tiếp', 400);
    }

    const finalRating = data.rating;
    if (finalRating < 1 || finalRating > 5) {
      throw new AppError('Rating phải từ 1 đến 5', 400);
    }

    const mergedComment = (data.comment || '').trim();

    // AI là trọng tài chính nên phải có phán quyết TRƯỚC khi ghi review. Nếu AI không kiểm
    // được (sập API/parse hỏng) thì ghi 'pending' làm hàng đợi cho admin duyệt tay — phương
    // án cuối, để user không mất nội dung đã gõ và không bị chặn tính năng.
    const verdict = mergedComment ? await moderateContent(mergedComment) : null;
    const aiDecided = verdict?.checked === true;
    // Review chỉ chấm sao không cần kiểm duyệt → visible ngay; chỉ 'pending' khi AI bất lực.
    const awaitingAdmin = verdict !== null && !aiDecided;
    const aiRejected = aiDecided && !verdict!.isAppropriate;
    const rejectionReason = aiRejected
      ? verdict!.reason || 'Bình luận chứa ngôn từ không phù hợp'
      : '';

    return Review.create({
      userId: new mongoose.Types.ObjectId(userId),
      productId: new mongoose.Types.ObjectId(data.productId),
      rating: finalRating,
      comment: mergedComment,
      images: data.images || [],
      isAnonymous: data.isAnonymous || false,
      status: aiRejected ? 'rejected' : awaitingAdmin ? 'pending' : 'visible',
      rejectionReason,
      aiRejected,
      moderatedBy: aiDecided ? 'AI' : '',
      moderatedByType: aiDecided ? ('ai' as const) : ('' as const),
    });
  }

  /**
   * Lưới chắn cuối: chỉ dùng cho review 'pending' (AI không phán quyết được).
   * Review AI đã quyết là quyết định cuối, admin không sửa.
   */
  static async moderate(reviewId: string, status: 'visible' | 'rejected', adminName?: string) {
    const review = await Review.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(reviewId), status: 'pending' },
      { $set: { status, moderatedBy: adminName || 'Admin', moderatedByType: 'admin' } },
      { new: true }
    )
      .populate('userId', 'fullName username email')
      .populate('productId', 'name')
      .lean();

    if (!review) {
      throw new AppError('Đánh giá này không còn ở trạng thái chờ duyệt', 400);
    }
    return review;
  }

  static async getById(reviewId: string) {
    return Review.findById(reviewId)
      .populate('userId', 'fullName username email')
      .populate('productId', 'name')
      .lean();
  }

  static async getAll(page = 1, limit = 20, status?: string, search?: string, rating?: number) {
    const query: Record<string, any> = {};
    if (status && ['visible', 'pending', 'rejected'].includes(status)) {
      query.status = status;
    }
    if (rating && rating >= 1 && rating <= 5) {
      query.rating = rating;
    }

    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const [matchingProducts, matchingUsers] = await Promise.all([
        Product.find({ name: new RegExp(safe, 'i') }, '_id').lean(),
        User.find({ email: new RegExp(safe, 'i') }, '_id').lean(),
      ]);
      const productIds = matchingProducts.map((p: any) => p._id);
      const userIds = matchingUsers.map((u: any) => u._id);
      if (productIds.length > 0 || userIds.length > 0) {
        query.$or = [];
        if (productIds.length > 0) query.$or.push({ productId: { $in: productIds } });
        if (userIds.length > 0) query.$or.push({ userId: { $in: userIds } });
      }
    }

    const skip = (page - 1) * limit;
    const [reviews, total, pendingCount] = await Promise.all([
      Review.find(query)
        .populate('userId', 'fullName username email')
        .populate('productId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Review.countDocuments(query),
      // Hàng đợi dự phòng khi AI gián đoạn — trả riêng để admin UI thấy ngay có việc cần làm.
      Review.countDocuments({ status: 'pending' }),
    ]);

    return { reviews, total, page, totalPages: Math.ceil(total / limit), pendingCount };
  }
}
