import type { FastifyRequest, FastifyReply } from 'fastify';
import { ReviewService } from '../services/ReviewService.ts';
import { ImageService } from '../services/ImageService.ts';
import { requireAdmin } from '../utils/adminAuth.ts';
import { verifyAccessToken } from '../utils/auth.ts';
import { User } from '../models/User.ts';

export class ReviewController {
  static async getByProduct(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { productId } = req.params as { productId: string };
      const { page = '1', limit = '10', rating, hasImages, hasComment } = req.query as { page?: string; limit?: string; rating?: string; hasImages?: string; hasComment?: string };

      let currentUserId: string | undefined = undefined;
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const token = authHeader.substring(7);
          const decoded = verifyAccessToken(token);
          currentUserId = decoded.userId;
        } catch {}
      }

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
      const stats = await ReviewService.getStats(productId);
      return reply.send({ success: true, data: stats });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  static async create(req: FastifyRequest, reply: FastifyReply) {
    try {
      const user = (req as any).user;
      const userId = user.userId || user._id?.toString();
      const body = req.body as {
        productId: string;
        orderItemId?: string;
        rating?: number;
        comment?: string;
        overallComment?: string;
        images?: string[];
        aspects?: { name: string; rating: number; comment?: string }[];
        isAnonymous?: boolean;
      };

      if (!body.productId) return reply.status(400).send({ success: false, message: 'productId là bắt buộc' });
      if (!body.rating && (!body.aspects || body.aspects.length === 0)) {
        return reply.status(400).send({ success: false, message: 'Vui lòng chọn số sao hoặc đánh giá chi tiết' });
      }
      if (body.aspects) {
        for (const a of body.aspects) {
          if (!a.rating || a.rating < 1 || a.rating > 5) {
            return reply.status(400).send({ success: false, message: `rating cho "${a.name}" phải từ 1 đến 5` });
          }
        }
      }

      const review = await ReviewService.create(userId, body as any);
      return reply.status(201).send({ success: true, data: review });
    } catch (err: any) {
      if (err.code === 11000) {
        return reply.status(400).send({ success: false, message: 'Bạn đã review sản phẩm này rồi' });
      }
      return reply.status(400).send({ success: false, message: err.message });
    }
  }

  static async update(req: FastifyRequest, reply: FastifyReply) {
    try {
      const user = (req as any).user;
      const userId = user.userId || user._id?.toString();
      const { id } = req.params as { id: string };
      const body = req.body as {
        rating?: number;
        comment?: string;
        overallComment?: string;
        images?: string[];
        aspects?: { name: string; rating: number; comment?: string }[];
        isAnonymous?: boolean;
      };

      if (body.aspects) {
        for (const a of body.aspects) {
          if (!a.rating || a.rating < 1 || a.rating > 5) {
            return reply.status(400).send({ success: false, message: `rating cho "${a.name}" phải từ 1 đến 5` });
          }
        }
      }
      if (body.rating !== undefined && (body.rating < 1 || body.rating > 5)) {
        return reply.status(400).send({ success: false, message: 'rating phải từ 1 đến 5' });
      }

      const review = await ReviewService.update(userId, id, body as any);
      return reply.send({ success: true, data: review });
    } catch (err: any) {
      return reply.status(400).send({ success: false, message: err.message });
    }
  }

  static async delete(req: FastifyRequest, reply: FastifyReply) {
    try {
      const user = (req as any).user;
      const userId = user.userId || user._id?.toString();
      const { id } = req.params as { id: string };

      await ReviewService.delete(userId, id);
      return reply.send({ success: true, message: 'Đã xoá review' });
    } catch (err: any) {
      return reply.status(400).send({ success: false, message: err.message });
    }
  }

  static async getMyReviews(req: FastifyRequest, reply: FastifyReply) {
    try {
      const user = (req as any).user;
      const userId = user.userId || user._id?.toString();
      const { page = '1', limit = '10' } = req.query as { page?: string; limit?: string };
      const result = await ReviewService.getMyReviews(userId, parseInt(page), parseInt(limit));
      return reply.send({ success: true, ...result });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  static async moderate(req: FastifyRequest, reply: FastifyReply) {
    try {
      if (!requireAdmin(req, reply)) return;

      const { id } = req.params as { id: string };
      const { status } = req.body as { status: 'visible' | 'hidden' | 'rejected' };

      if (!status || !['visible', 'hidden', 'rejected'].includes(status)) {
        return reply.status(400).send({ success: false, message: 'status phải là visible, hidden hoặc rejected' });
      }

      // Lấy tên tài khoản admin đang thao tác
      let adminName = 'Admin';
      const userId = (req as any).user?.userId;
      if (userId) {
        const admin = await User.findById(userId).select('username').lean();
        if (admin?.username) adminName = admin.username;
      }

      const review = await ReviewService.moderate(id, status, adminName);
      return reply.send({ success: true, data: review });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  static async getById(req: FastifyRequest, reply: FastifyReply) {
    try {
      if (!requireAdmin(req, reply)) return;

      const { id } = req.params as { id: string };
      const review = await ReviewService.getById(id);
      if (!review) return reply.status(404).send({ success: false, message: 'Không tìm thấy đánh giá' });
      return reply.send({ success: true, data: review });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
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
      const userId = user.userId || user._id?.toString();
      const { productId } = req.params as { productId: string };

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
