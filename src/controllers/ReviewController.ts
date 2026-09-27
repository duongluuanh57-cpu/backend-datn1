import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { ReviewService } from '../services/ReviewService.ts';
import { ImageService } from '../services/ImageService.ts';
import { requireAdmin } from '../utils/adminAuth.ts';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/authMiddleware.ts';
import { User } from '../models/User.ts';

const isInvalidId = (id?: string) => !id || !mongoose.Types.ObjectId.isValid(id);

export class ReviewController {
  static async getByProduct(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { productId } = req.params as { productId: string };
      if (isInvalidId(productId)) {
        return reply.status(400).send({ success: false, message: 'ID sản phẩm không hợp lệ' });
      }
      const { page = '1', limit = '10', rating, hasImages, hasComment } = req.query as { page?: string; limit?: string; rating?: string; hasImages?: string; hasComment?: string };

      // Đã đăng nhập (cookie/Bearer qua optionalAuth) → được xem cả review pending/rejected của chính mình
      const currentUserId: string | undefined = (req as any).user?.userId;

      const result = await ReviewService.getByProduct(
        productId,
        parseInt(page),
        parseInt(limit),
        currentUserId,
        rating ? parseInt(rating) : undefined,
        hasImages === 'true',
        hasComment === 'true'
      );
      return reply.send({ success: true, ...result });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  static async getStats(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { productId } = req.params as { productId: string };
      if (isInvalidId(productId)) {
        return reply.status(400).send({ success: false, message: 'ID sản phẩm không hợp lệ' });
      }
      const stats = await ReviewService.getStats(productId);
      return reply.send({ success: true, data: stats });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  static async create(req: FastifyRequest, reply: FastifyReply) {
    try {
      const user = (req as any).user;
      if (!user?.userId) {
        return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập để đánh giá' });
      }
      const userId = user.userId || user._id?.toString();
      const body = req.body as {
        productId: string;
        rating?: number;
        comment?: string;
        images?: string[];
        isAnonymous?: boolean;
      };

      const { productId, rating, comment, images, isAnonymous } = body;

      if (!productId) return reply.status(400).send({ success: false, message: 'productId là bắt buộc' });
      if (isInvalidId(productId)) {
        return reply.status(400).send({ success: false, message: 'ID sản phẩm không hợp lệ' });
      }
      if (!rating || rating < 1 || rating > 5) {
        return reply.status(400).send({ success: false, message: 'Vui lòng chọn số sao từ 1 đến 5' });
      }

      const review = await ReviewService.create(userId, { productId, rating, comment, images, isAnonymous });
      return reply.status(201).send({ success: true, data: review });
    } catch (err: any) {
      if (err.code === 11000) {
        return reply.status(400).send({ success: false, message: 'Bạn đã review sản phẩm này rồi' });
      }
      return reply.status(err.statusCode ?? 500).send({ success: false, message: err.message });
    }
  }

  static async getById(req: FastifyRequest, reply: FastifyReply) {
    try {
      if (!requireAdmin(req, reply)) return;

      const { id } = req.params as { id: string };
      if (isInvalidId(id)) {
        return reply.status(400).send({ success: false, message: 'ID đánh giá không hợp lệ' });
      }
      const review = await ReviewService.getById(id);
      if (!review) return reply.status(404).send({ success: false, message: 'Không tìm thấy đánh giá' });
      return reply.send({ success: true, data: review });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /**
   * Duyệt tay thủ công — chỉ dành cho review 'pending' (luồng AI gián đoạn).
   * Review AI đã phán quyết thì không sửa được (ReviewService.moderate chặn).
   */
  static async moderate(req: FastifyRequest, reply: FastifyReply) {
    try {
      if (!requireAdmin(req, reply)) return;

      const { id } = req.params as { id: string };
      const { status } = req.body as { status?: string };
      if (isInvalidId(id)) {
        return reply.status(400).send({ success: false, message: 'ID đánh giá không hợp lệ' });
      }
      if (status !== 'visible' && status !== 'rejected') {
        return reply.status(400).send({ success: false, message: 'Trạng thái không hợp lệ' });
      }

      const admin = await User
        .findById((req as any).user.userId)
        .select('fullName username email')
        .lean();
      const review = await ReviewService.moderate(
        id,
        status,
        admin?.fullName || admin?.username || admin?.email || 'Admin'
      );
      return reply.send({ success: true, data: review });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ success: false, message: err.message });
    }
  }

  static async getAll(req: FastifyRequest, reply: FastifyReply) {
    try {
      if (!requireAdmin(req, reply)) return;

      const { page = '1', limit = '20', status, search, rating } = req.query as { page?: string; limit?: string; status?: string; search?: string; rating?: string };
      const result = await ReviewService.getAll(
        parseInt(page),
        parseInt(limit),
        status,
        search,
        rating ? parseInt(rating) : undefined
      );
      return reply.send({ success: true, ...result });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  static async canReview(req: FastifyRequest, reply: FastifyReply) {
    try {
      const user = (req as any).user;
      if (!user?.userId) {
        return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập để đánh giá' });
      }
      const userId = user.userId || user._id?.toString();
      const { productId } = req.params as { productId: string };
      if (isInvalidId(productId)) {
        return reply.status(400).send({ success: false, message: 'ID sản phẩm không hợp lệ' });
      }

      const result = await ReviewService.canReview(userId, productId);
      return reply.send({ success: true, data: result });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  static async uploadReviewImage(req: FastifyRequest, reply: FastifyReply) {
    try {
      const file = await req.file();
      if (!file) {
        return reply.status(400).send({ success: false, message: 'Không tìm thấy file ảnh' });
      }

      const buffer = await file.toBuffer();
      const result = await ImageService.compressAndUpload(buffer, {
        folder: 'reviews',
        maxWidth: 1200,
        quality: 85,
      });

      return reply.status(200).send({ success: true, data: { url: result.url } });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message || 'Lỗi khi upload ảnh' });
    }
  }
}
