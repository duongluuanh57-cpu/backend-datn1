import type { FastifyRequest, FastifyReply } from 'fastify';
import { Favorite } from '../models/Favorite.ts';
import { User } from '../models/User.ts';
import { Product } from '../models/Product.ts';
import { ProductVariant } from '../models/ProductVariant.ts';
import { ProductImage } from '../models/ProductImage.ts';
import { Review } from '../models/Review.ts';
import { bySizeAsc } from '../services/product/productHelpers.ts';
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
          select: 'name brandId image discountPercentage soldCount status',
          populate: {
            path: 'brandId',
            select: 'name logo',
          },
        })
        .sort({ _id: -1 })
        .lean();

      // ponytail: product bị xóa → populate trả null. Lọc bỏ thay vì cascade-delete
      // favorite (giữ controller đơn giản). Trần: dòng favorite "mồ côi" tích tụ dần
      // trong DB; nếu cần dọn thì xóa Favorite theo productId ở tầng xóa product.
      const validFavorites = favorites.filter(f => f.productId);

      // Attach computed price from variant 50ml via batch variant query, product images,
      // and rating/reviewsCount computed live from Review (no denormalized cache on Product).
      const pIds = validFavorites.map(f => (f.productId as any)._id).filter(Boolean);
      const [allProductVariants, allProductImages, reviewAgg] = await Promise.all([
        ProductVariant.find({ productId: { $in: pIds } }).lean().then((vs: any[]) => vs.sort(bySizeAsc)) as Promise<any[]>,
        ProductImage.find({ productId: { $in: pIds } }).select('url productId').sort({ _id: 1 }).lean() as Promise<any[]>,
        Review.aggregate([
          { $match: { productId: { $in: pIds.map(id => new mongoose.Types.ObjectId(id)) }, status: 'visible' } },
          { $group: { _id: '$productId', count: { $sum: 1 }, avg: { $avg: '$rating' } } },
        ]),
      ]);

      const reviewMap = new Map<string, { count: number; avg: number }>();
      for (const r of reviewAgg) reviewMap.set(r._id.toString(), { count: r.count, avg: Math.round(r.avg * 10) / 10 });

      const variantGroupMap: Record<string, any[]> = {};
      allProductVariants.forEach(v => {
        const pid = String(v.productId);
        if (!variantGroupMap[pid]) variantGroupMap[pid] = [];
        variantGroupMap[pid].push(v);
      });

      const imageGroupMap: Record<string, string> = {};
      allProductImages.forEach((img: any) => {
        const pid = String(img.productId);
        if (!imageGroupMap[pid]) imageGroupMap[pid] = img.url;
      });

      const enriched = validFavorites.map((fav) => {
        const product = fav.productId as any;
        const productIdStr = product._id.toString();
        const productVariants = variantGroupMap[productIdStr] || [];
        const variant50ml = productVariants.find(v => v.size === '50ml');
        const variant = variant50ml || productVariants[0];
        const quantityInStock = productVariants.reduce((sum, v) => sum + (v.quantityInStock || 0), 0);
        let price = variant?.price || 0;
        const originalPrice = price;
        if (price > 0 && product.discountPercentage > 0) {
          price = Math.round(price * (1 - product.discountPercentage / 100));
        }

        const brandLogo = product.brandId?.logo;
        let finalImage = imageGroupMap[productIdStr] || product.image || '';
        // If product image matches brand logo, prefer actual product image or clear fallback
        if (brandLogo && finalImage === brandLogo) {
          finalImage = imageGroupMap[productIdStr] || '';
        }

        const reviewStats = reviewMap.get(productIdStr);
        const reviewsCount = reviewStats?.count ?? 0;
        const avgRating = reviewStats?.avg ?? 0;

        return {
          ...fav,
          productId: {
            ...product,
            image: finalImage,
            price,
            originalPrice,
            quantityInStock,
            discount: product.discountPercentage || 0,
            brand: product.brandId?.name || '',
            reviewsCount,
            avgRating,
            rating: avgRating,
          },
        };
      });

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