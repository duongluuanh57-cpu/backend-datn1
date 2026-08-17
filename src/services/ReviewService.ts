import mongoose from 'mongoose';
import { Review, type IReviewAspect, type AspectName, ASPECT_OPTIONS } from '../models/Review.ts';
import { Product } from '../models/Product.ts';
import { OrderItem } from '../models/OrderItem.ts';
import { Order } from '../models/Order.ts';
import { User } from '../models/User.ts';
import { moderateContent, LOCKED_MODERATION_CATEGORIES } from './ai/aiModerationService.ts';

const VALID_ASPECTS = Object.keys(ASPECT_OPTIONS);

function computeAvgRating(aspects: IReviewAspect[]): number {
  if (!aspects || aspects.length === 0) return 0;
  const sum = aspects.reduce((acc, a) => acc + a.rating, 0);
  return Math.round((sum / aspects.length) * 10) / 10;
}

export class ReviewService {
  static async canReview(
    userId: string,
    productId: string
  ): Promise<{ canReview: boolean; purchasedCount: number; reviewedCount: number }> {
    const pid = new mongoose.Types.ObjectId(productId);
    const uid = new mongoose.Types.ObjectId(userId);

    const [deliveredOrders, reviewedCount] = await Promise.all([
      Order.find({ userId: uid, status: 'delivered' }).lean(),
      Review.countDocuments({ userId: uid, productId: pid }),
    ]);

    const orderIds = deliveredOrders.map((o) => o._id);
    const orderItems = await OrderItem.find({ orderId: { $in: orderIds }, productId: pid })
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
      'rating aspects'
    ).lean();

    if (!reviews.length) {
      return { avgRating: 0, total: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    }

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalRating = 0;
    let count = 0;

    for (const r of reviews) {
      if (r.aspects && r.aspects.length > 0) {
        for (const a of r.aspects) {
          distribution[a.rating] = (distribution[a.rating] || 0) + 1;
          totalRating += a.rating;
          count++;
        }
      } else {
        distribution[r.rating] = (distribution[r.rating] || 0) + 1;
        totalRating += r.rating;
        count++;
      }
    }

    return {
      avgRating: count > 0 ? Math.round((totalRating / count) * 10) / 10 : 0,
      total: reviews.length,
      distribution,
    };
  }

  static async create(
    userId: string,
    data: {
      productId: string;
      orderItemId?: string;
      rating?: number;
      comment?: string;
      overallComment?: string;
      images?: string[];
      aspects?: { name: AspectName; rating: number; comment?: string }[];
      isAnonymous?: boolean;
    }
  ) {
    // Mandatory purchase verification
    const { canReview, purchasedCount, reviewedCount } = await ReviewService.canReview(
      userId,
      data.productId
    );
    if (!canReview) {
      if (purchasedCount === 0) {
        throw new Error('Bạn cần mua sản phẩm này để đánh giá');
      }
      throw new Error('Bạn đã đánh giá hết lượt mua. Vui lòng mua thêm để đánh giá tiếp');
    }

    const aspects: IReviewAspect[] = (data.aspects || []).map((a) => ({
      name: a.name,
      rating: a.rating,
      comment: a.comment || '',
    }));

    for (const a of aspects) {
      if (!VALID_ASPECTS.includes(a.name)) {
        throw new Error(`Khía cạnh "${a.name}" không hợp lệ`);
      }
    }

    const hasAspects = aspects.length > 0;
    const avgRating = hasAspects ? computeAvgRating(aspects) : (data.rating || 0);
    const finalRating = avgRating > 0 ? avgRating : (data.rating || 0);

    if (finalRating < 1 || finalRating > 5) {
      throw new Error('Rating phải từ 1 đến 5');
    }

    // Build comment from aspects + overallComment
    let mergedComment = '';
    if (hasAspects) {
      mergedComment = aspects.map((a) => a.comment).filter(Boolean).join('\n');
    } else {
      mergedComment = data.comment || '';
    }
    if (data.overallComment) {
      mergedComment = mergedComment ? `${mergedComment}\n\n${data.overallComment}` : data.overallComment;
    }

    const review = await Review.create({
      userId: new mongoose.Types.ObjectId(userId),
      productId: new mongoose.Types.ObjectId(data.productId),
      orderItemId: data.orderItemId ? new mongoose.Types.ObjectId(data.orderItemId) : undefined,
      rating: finalRating,
      comment: mergedComment,
      overallComment: data.overallComment || '',
      aspects,
      images: data.images || [],
      isAnonymous: data.isAnonymous || false,
      status: 'pending',
    });

    const commentText = (mergedComment || data.overallComment || '').trim();
    if (!commentText) {
      review.status = 'visible';
      await review.save();
      await ReviewService.updateProductStats(data.productId);
      return review;
    }

    // Run AI Moderation
    const moderation = await moderateContent(commentText);
    if (moderation.isAppropriate) {
      review.status = 'visible';
      review.moderatedBy = 'AI';
      review.moderatedByType = 'ai';
    } else {
      review.status = 'rejected';
      review.rejectionReason = moderation.reason || 'Bình luận chứa ngôn từ không phù hợp';
      review.aiRejected = LOCKED_MODERATION_CATEGORIES.includes(moderation.category);
      review.moderatedBy = 'AI';
      review.moderatedByType = 'ai';
    }
    await review.save();

    if (review.status === 'visible') {
      await ReviewService.updateProductStats(data.productId);
    }
    return review;
  }

  static async update(
    userId: string,
    reviewId: string,
    data: {
      rating?: number;
      comment?: string;
      overallComment?: string;
      images?: string[];
      aspects?: { name: AspectName; rating: number; comment?: string }[];
      isAnonymous?: boolean;
    }
  ) {
    const review = await Review.findOne({ _id: reviewId, userId: new mongoose.Types.ObjectId(userId) });
    if (!review) {
      throw new Error('Không tìm thấy review hoặc bạn không có quyền sửa');
    }

    if (data.aspects) {
      const aspects: IReviewAspect[] = data.aspects.map((a) => ({
        name: a.name,
        rating: a.rating,
        comment: a.comment || '',
      }));
      for (const a of aspects) {
        if (!VALID_ASPECTS.includes(a.name)) {
          throw new Error(`Khía cạnh "${a.name}" không hợp lệ`);
        }
      }
      review.aspects = aspects;
      review.rating = computeAvgRating(aspects);
      const aspectComments = aspects.map((a) => a.comment).filter(Boolean).join('\n');
      review.comment = data.overallComment
        ? `${aspectComments}\n\n${data.overallComment}`
        : aspectComments;
    }
    if (data.rating !== undefined) review.rating = data.rating;
    if (data.comment !== undefined) review.comment = data.comment;
    if (data.overallComment !== undefined) review.overallComment = data.overallComment;
    if (data.images !== undefined) review.images = data.images;
    if (data.isAnonymous !== undefined) review.isAnonymous = data.isAnonymous;
    await review.save();

    await ReviewService.updateProductStats(review.productId.toString());
    return review;
  }

  static async delete(userId: string, reviewId: string) {
    const review = await Review.findOneAndDelete({
      _id: reviewId,
      userId: new mongoose.Types.ObjectId(userId),
    });
    if (!review) {
      throw new Error('Không tìm thấy review hoặc bạn không có quyền xoá');
    }

    await ReviewService.updateProductStats(review.productId.toString());
    return review;
  }

  static async getMyReviews(userId: string, page = 1, limit = 10) {
    const query = { userId: new mongoose.Types.ObjectId(userId) };
    const skip = (page - 1) * limit;

    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate('productId', 'name image')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Review.countDocuments(query),
    ]);

    return { reviews, total, page, totalPages: Math.ceil(total / limit) };
  }

  static async moderate(reviewId: string, status: 'visible' | 'hidden' | 'rejected', adminName?: string) {
    const review = await Review.findById(reviewId);
    if (!review) {
      throw new Error('Không tìm thấy review');
    }

    // Bình luận bị AI từ chối là khóa vĩnh viễn, không thể thay đổi trạng thái
    if (review.aiRejected && status !== 'rejected') {
      throw new Error('Bình luận đã bị AI từ chối, không thể thay đổi trạng thái');
    }

    review.status = status;
    review.moderatedBy = adminName || 'Admin';
    review.moderatedByType = 'admin';
    await review.save();

    await ReviewService.updateProductStats(review.productId.toString());
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
    if (status && ['visible', 'hidden', 'pending', 'rejected'].includes(status)) {
      query.status = status;
    }
    if (rating && rating >= 1 && rating <= 5) {
      query.rating = rating;
    }

    if (search) {
      const [matchingProducts, matchingUsers] = await Promise.all([
        Product.find({ name: new RegExp(search, 'i') }, '_id').lean(),
        User.find({ email: new RegExp(search, 'i') }, '_id').lean(),
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
    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate('userId', 'fullName username email')
        .populate('productId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Review.countDocuments(query),
    ]);

    return { reviews, total, page, totalPages: Math.ceil(total / limit) };
  }

  private static async updateProductStats(productId: string) {
    const reviews = await Review.find(
      { productId: new mongoose.Types.ObjectId(productId), status: 'visible' },
      'rating aspects'
    ).lean();

    let totalRating = 0;
    let count = 0;

    for (const r of reviews) {
      if (r.aspects && r.aspects.length > 0) {
        for (const a of r.aspects) {
          totalRating += a.rating;
          count++;
        }
      } else {
        totalRating += r.rating;
        count++;
      }
    }

    const update: Record<string, any> = {};
    if (count > 0) {
      update.reviewsCount = reviews.length;
      update.avgRating = Math.round((totalRating / count) * 10) / 10;
    } else {
      update.reviewsCount = 0;
      update.avgRating = 0;
    }

    await Product.findByIdAndUpdate(productId, { $set: update });
  }
}
