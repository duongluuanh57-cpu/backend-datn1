import type { FastifyRequest, FastifyReply } from 'fastify';
import { ProductService } from '../../services/ProductService.ts';
import { ProductImage } from '../../models/ProductImage.ts';
import { Product } from '../../models/Product.ts';
import { Brand } from '../../models/Brand.ts';

export class ProductListingController {
  /**
   * GET /api/products/new
   */
  static async getNewProducts(req: FastifyRequest, reply: FastifyReply) {
    try {
      const products = await ProductService.getNewProducts();
      return reply.status(200).send({ success: true, data: products });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  /**
   * GET /api/products/limited
   */
  static async getLimitedProducts(req: FastifyRequest, reply: FastifyReply) {
    try {
      const products = await ProductService.getLimitedProducts();
      return reply.status(200).send({ success: true, data: products });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  /**
   * GET /api/products/trending
   */
  static async getTrendingProducts(req: FastifyRequest, reply: FastifyReply) {
    try {
      const products = await ProductService.getTrendingProducts();
      return reply.status(200).send({ success: true, data: products });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  /**
   * GET /api/products/public?type=trending|new|limited&brand=&capacity=&minPrice=&maxPrice=&scentGroup=&concentration=&segment=&sortBy=newest&limit=20
   */
  static async getPublicProducts(req: FastifyRequest, reply: FastifyReply) {
    try {
      const query = req.query as {
        type?: string;
        brand?: string;
        capacity?: string;
        priceRange?: string;
        minPrice?: string;
        maxPrice?: string;
        scentGroup?: string;
        concentration?: string;
        segment?: string;
        sortBy?: string;
        limit?: string;
        filterTag?: string;
      };

      const type = query.type as 'trending' | 'new' | 'limited';
      if (!type || !['trending', 'new', 'limited'].includes(type)) {
        return reply.status(400).send({ success: false, message: 'Invalid type. Must be trending, new, or limited.' });
      }

      const products = await ProductService.getPublicProducts(type, {
        brand: query.brand,
        capacity: query.capacity,
        priceRange: query.priceRange,
        minPrice: query.minPrice ? Number(query.minPrice) : undefined,
        maxPrice: query.maxPrice ? Number(query.maxPrice) : undefined,
        scentGroup: query.scentGroup,
        concentration: query.concentration,
        segment: query.segment,
        sortBy: query.sortBy || 'newest',
        limit: query.limit ? parseInt(query.limit, 10) : 20,
        filterTag: query.filterTag,
      });

      return reply.status(200).send({ success: true, data: products });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  /**
   * GET /api/products/sale
   */
  static async getSaleProducts(req: FastifyRequest, reply: FastifyReply) {
    try {
      const products = await ProductService.getSaleProducts();
      return reply.status(200).send({ success: true, data: products });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  /**
   * GET /api/products
   * Query params: page, limit, search, brand, stock, tag, sortBy
   */
  static async getAllProducts(req: FastifyRequest, reply: FastifyReply) {
    try {
      const query = req.query as {
        page?: string;
        limit?: string;
        search?: string;
        brand?: string;
        stock?: string;
        tag?: string;
        category?: string;
        sortBy?: string;
        status?: string;
      };

      const result = await ProductService.getAllProducts({
        page: query.page ? parseInt(query.page, 10) : 1,
        limit: query.limit ? parseInt(query.limit, 10) : 25,
        search: query.search,
        brand: query.brand,
        stock: query.stock,
        tag: query.tag,
        category: query.category,
        sortBy: query.sortBy,
        status: query.status,
      });

      return reply.status(200).send({ success: true, data: result });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  /**
   * GET /api/products/suggest?q=...&limit=8
   */
  static async suggestProducts(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { q, limit } = req.query as { q?: string; limit?: string };
      const products = await ProductService.suggestProducts(
        (q ?? '').trim(),
        limit ? Math.min(parseInt(limit, 10), 20) : 8
      );
      return reply.status(200).send({ success: true, data: products });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  /**
   * GET /api/products/bulk?ids=id1,id2,id3
   */
  static async getBulkProducts(req: FastifyRequest, reply: FastifyReply) {
    try {
      const query = req.query as { ids?: string };
      if (!query.ids) {
        return reply.status(400).send({ success: false, message: 'Missing ids query parameter.' });
      }
      const ids = query.ids.split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length > 20) {
        return reply.status(400).send({ success: false, message: 'Maximum 20 IDs allowed.' });
      }
      const products = await ProductService.getBulkProducts(ids);
      return reply.status(200).send({ success: true, data: products });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  /**
   * GET /api/products/:id
   */
  static async getProductById(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      const product = await ProductService.getProductById(id);
      if (!product) return reply.status(404).send({ success: false, message: 'Không tìm thấy sản phẩm' });
      return reply.status(200).send({ success: true, data: product });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  static async getProductByIdAdmin(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      const product = await ProductService.getProductByIdAdmin(id);
      if (!product) return reply.status(404).send({ success: false, message: 'Không tìm thấy sản phẩm' });
      return reply.status(200).send({ success: true, data: product });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  /**
   * GET /api/products/:id/images
   */
  static async getProductImages(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      const images = await ProductImage.find({ productId: id }).sort({ createdAt: 1 });
      return reply.status(200).send({ success: true, data: images.map(img => img.url) });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  /**
   * POST /api/products/:id/track-view
   * Increments viewCount on a product (Redis-style, direct MongoDB increment)
   */
  static async trackProductView(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string };
      const result = await Product.updateOne({ _id: id }, { $inc: { viewCount: 1 } });
      return reply.status(200).send({ success: true, modified: result.modifiedCount > 0 });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  /**
   * GET /api/products/top-brands-by-views
   * Aggregates product viewCount by brand, returns top brands sorted by total views
   */
  static async getTopBrandsByViews(req: FastifyRequest, reply: FastifyReply) {
    try {
      const query = req.query as { limit?: string };
      const limit = query.limit ? Math.min(parseInt(query.limit, 10), 50) : 20;

      const agg = await Product.aggregate([
        { $group: { _id: '$brandId', totalViews: { $sum: '$viewCount' }, productCount: { $sum: 1 } } },
        { $sort: { totalViews: -1 } },
        { $limit: limit },
      ]);

      const brandIds = agg.map(a => a._id).filter(Boolean);
      const brands = await Brand.find({ _id: { $in: brandIds } }).select('name').lean() as any[];
      const brandNameMap = new Map<string, string>();
      for (const b of brands) brandNameMap.set(b._id.toString(), b.name);

      const data = agg.map(a => ({
        brandId: a._id,
        brandName: brandNameMap.get(a._id?.toString()) || 'Unknown',
        totalViews: a.totalViews,
        productCount: a.productCount,
      }));

      return reply.status(200).send({ success: true, data });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }

  /**
   * GET /api/products/needs-supplement
   * Trả về danh sách sản phẩm cần bổ sung thông tin
   */
  static async getNeedsSupplement(req: FastifyRequest, reply: FastifyReply) {
    try {
      const scentKeys = ['longevity', 'sillage', 'durability', 'scentTrail', 'style', 'suitableFor', 'occasion', 'season', 'time'];

      // Draft + active products missing essential info
      const products = await Product.find({
        $or: [
          { status: 'draft' },
          {
            status: 'active',
            $or: [
              { $or: [{ description: { $exists: false } }, { description: '' }, { description: null }] },
              { brandId: { $exists: false } },
              { $expr: { $lt: [{ $size: { $ifNull: ['$categories', []] } }, 2] } },
              { $expr: { $eq: [{ $size: { $ifNull: ['$variants', []] } }, 0] } },
              ...scentKeys.map(key => ({ [key]: { $in: ['', null] } })),
            ],
          },
        ],
      })
        .select('name image brandId description categories variants status ' + scentKeys.join(' '))
        .populate('brandId', 'name')
        .populate('categories', 'name')
        .sort({ createdAt: -1 })
        .lean();

      const toDowngrade: string[] = [];
      const data = products.map((p: any) => {
        const missing: string[] = [];
        if (!p.description || p.description.length < 50) missing.push('description');
        if (!p.variants || p.variants.length === 0) missing.push('variants');
        if (!p.brandId) missing.push('brand');
        if (!p.categories || p.categories.length < 2) missing.push('categories');
        scentKeys.forEach(function(key) { if (!p[key]) missing.push(key); });

        if (p.status === 'active' && missing.length > 0) {
          toDowngrade.push(p._id);
        }

        return {
          _id: p._id,
          name: p.name,
          brand: p.brandId?.name || '',
          image: p.image || '',
          description: p.description || '',
          categories: (p.categories || []).map((c: any) => c.name),
          missing,
          missingCount: missing.length,
          status: p.status,
        };
      });

      // Auto-downgrade active→draft nếu thiếu info
      if (toDowngrade.length > 0) {
        await Product.updateMany({ _id: { $in: toDowngrade } }, { status: 'draft' });
      }

      return reply.status(200).send({ success: true, data, total: data.length });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: error.message });
    }
  }
}
