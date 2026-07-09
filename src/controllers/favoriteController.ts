import type { FastifyRequest, FastifyReply } from 'fastify';
import { Favorite } from '../models/Favorite.ts';
import { User } from '../models/User.ts';
import { Product } from '../models/Product.ts';
import { ProductVariant } from '../models/ProductVariant.ts';
import mongoose from 'mongoose';

export class FavoriteController {
  /**
   * GET /api/favorites
   * Lấy danh sách sản phẩm yêu thích của user đang đăng nhập
   */
  static async getFavorites(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const favorites = await Favorite.find({ userId: new mongoose.Types.ObjectId(userId) })
        .populate({
          path: 'productId',
          select: 'name brand image discountPercentage discountStartDate discountEndDate variants',
        })
        .sort({ createdAt: -1 })
        .lean();

      // Filter out null productId (deleted products)
      const validFavorites = favorites.filter(f => f.productId);

      // Attach computed price from variant 50ml
      const enriched = await Promise.all(validFavorites.map(async (fav) => {
        const product = fav.productId as any;
        const productId = product._id.toString();
        const variant50ml = await ProductVariant.findOne({ productId, size: '50ml' }).lean() as any;
        const variant = variant50ml || await ProductVariant.findOne({ productId }).sort({ sortOrder: 1 }).lean() as any;
        let price = variant?.price || 0;
        if (price > 0 && product.discountPercentage > 0) {
          const now = new Date();
          const startOk = !product.discountStartDate || new Date(product.discountStartDate) <= now;
          const endOk = !product.discountEndDate || new Date(product.discountEndDate) >= now;
          if (startOk && endOk) price = Math.round(price * (1 - product.discountPercentage / 100));
        }
        return {
          ...fav,
          productId: {
            ...product,
            price,
            discount: product.discountPercentage || 0,
          },
        };
      }));

      return reply.send({ success: true, data: enriched });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/favorites
   * Thêm sản phẩm vào danh sách yêu thích
   */
  static async addToFavorites(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const { productId } = req.body as { productId: string };

      if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
        return reply.status(400).send({ success: false, message: 'ID sản phẩm không hợp lệ' });
      }

      // Check if product exists
      const product = await Product.findById(productId).lean();
      if (!product) {
        return reply.status(404).send({ success: false, message: 'Sản phẩm không tồn tại' });
      }

      const user = await User.findById(userId).lean();
      if (!user) {
        return reply.status(404).send({ success: false, message: 'Người dùng không tồn tại' });
      }

      // Check if already favorited
      const existing = await Favorite.findOne({
        userId: new mongoose.Types.ObjectId(userId),
        productId: new mongoose.Types.ObjectId(productId),
      });

      if (existing) {
        return reply.send({ success: true, data: existing, message: 'Sản phẩm đã có trong danh sách yêu thích' });
      }

      const favorite = await Favorite.create({
        userId: new mongoose.Types.ObjectId(userId),
        productId: new mongoose.Types.ObjectId(productId),
      });

      return reply.status(201).send({ success: true, data: favorite });
    } catch (err: any) {
      if (err.code === 11000) {
        return reply.send({ success: true, message: 'Sản phẩm đã có trong danh sách yêu thích' });
      }
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /**
   * DELETE /api/favorites/:productId
   * Xóa sản phẩm khỏi danh sách yêu thích
   */
  static async removeFromFavorites(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      const { productId } = req.params as { productId: string };
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
        return reply.status(400).send({ success: false, message: 'ID sản phẩm không hợp lệ' });
      }

      const deleted = await Favorite.findOneAndDelete({
        userId: new mongoose.Types.ObjectId(userId),
        productId: new mongoose.Types.ObjectId(productId),
      });

      if (!deleted) {
        return reply.status(404).send({ success: false, message: 'Không tìm thấy sản phẩm trong danh sách yêu thích' });
      }

      return reply.send({ success: true, message: 'Đã xóa khỏi danh sách yêu thích' });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/favorites/ids
   * Trả về danh sách productId đã yêu thích (1 request duy nhất)
   */
  static async getFavoriteIds(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const favorites = await Favorite.find({ userId: new mongoose.Types.ObjectId(userId) })
        .select('productId')
        .lean();

      const ids = favorites.map(f => f.productId.toString());
      return reply.send({ success: true, data: { ids, count: ids.length } });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/favorites/check/:productId
   * Kiểm tra xem sản phẩm có trong danh sách yêu thích không
   */
  static async checkFavorite(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      const { productId } = req.params as { productId: string };
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
        return reply.status(400).send({ success: false, message: 'ID sản phẩm không hợp lệ' });
      }

      const favorite = await Favorite.findOne({
        userId: new mongoose.Types.ObjectId(userId),
        productId: new mongoose.Types.ObjectId(productId),
      });

      return reply.send({
        success: true,
        data: { isFavorited: !!favorite, isFavorite: !!favorite },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }
}