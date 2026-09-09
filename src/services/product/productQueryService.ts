import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Product } from '../../models/Product.ts';
import { redis } from '../../config/redis.ts';
import { Brand } from '../../models/Brand.ts';
import { Tag } from '../../models/Tag.ts';
import { ProductTag } from '../../models/ProductTag.ts';
import { Category } from '../../models/Category.ts';
import { Review } from '../../models/Review.ts';
import { ProductImage } from '../../models/ProductImage.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { formatMultipleProducts, getDefaultVariant } from './productFormatterService.ts';
import { DiscountLifecycleService } from './discountLifecycleService.ts';
import { resolveCategoryNames } from './productHelpers.ts';
import { OrderItem } from '../../models/OrderItem.ts';
import { FlashSale } from '../../models/FlashSale.ts';
import { FlashSaleService } from '../FlashSaleService.ts';

export class ProductQueryService {
  private static CACHE_TTL = 300;

  // Cache tag slug → ID mapping
  private static tagCache = new Map<string, mongoose.Types.ObjectId>();

  private static async getTagIdsBySlugs(slugs: string[]): Promise<mongoose.Types.ObjectId[]> {
    const result: mongoose.Types.ObjectId[] = [];
    const misses: string[] = [];

    for (const slug of slugs) {
      const id = this.tagCache.get(slug.toLowerCase());
      if (id) {
        result.push(id);
      } else {
        misses.push(slug);
      }
    }

    // Cache miss — load all tags and match in-memory (case-insensitive)
    if (misses.length > 0) {
      const allTags = await Tag.find({ status: 'active' }).lean();
      for (const tag of allTags) {
        const slug = (tag.slug || '').toLowerCase();
        if (!this.tagCache.has(slug)) {
          this.tagCache.set(slug, tag._id);
        }
        if (tag.name.toLowerCase() === 'sản phẩm mới') {
          this.tagCache.set('san-pham-moi', tag._id);
          this.tagCache.set('new', tag._id);
        }
      }
      for (const slug of misses) {
        const id = this.tagCache.get(slug.toLowerCase());
        if (id && !result.some(r => r.equals(id))) {
          result.push(id);
        }
      }
    }

    return result;
  }

  static async getProductIdsByTagSlugs(slugs: string[]): Promise<mongoose.Types.ObjectId[]> {
    const tagIds = await this.getTagIdsBySlugs(slugs);
    if (tagIds.length === 0) return [];
    const links = await ProductTag.find({ tagId: { $in: tagIds } }).lean();
    return links.map(l => l.productId);
  }

  private static lastSyncNewArrivalTime = 0;

  /**
   * Đồng bộ quy tắc Tag New (Sản phẩm mới) — CHỈ lo tag, không đụng discount.
   * Discount do DiscountLifecycleService (mô hình trung tâm) đảm nhận.
   * - Sản phẩm trong vòng 31 ngày (createdAt <= 31 ngày) -> Gán Tag New, isNewArrival = true.
   * - Quá 31 ngày -> Gỡ Tag New, isNewArrival = false.
   */
  static async syncNewArrivalTags(): Promise<void> {
    const now = Date.now();
    // Giới hạn đồng bộ tối đa 1 lần mỗi 10 phút để tránh quét/ghi DB mỗi lượt mở trang chủ
    if (now - this.lastSyncNewArrivalTime < 600_000) return;
    this.lastSyncNewArrivalTime = now;

    try {
      const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      const newTag = await Tag.findOne({
        status: 'active',
        $or: [{ slug: /^new$/i }, { name: /^sản phẩm mới$/i }],
      }).lean();

      if (!newTag) return;

      const standardTag = await Tag.findOne({
        status: 'active',
        $or: [{ slug: /^standard$/i }, { name: /^tiêu chuẩn$/i }],
      }).lean();

      // 1. Sản phẩm quá 31 ngày -> Gỡ Tag New
      const newTagLinks = await ProductTag.find({ tagId: newTag._id }).lean();
      const newLinkedProdIds = newTagLinks.map(l => l.productId);
      const expiredProducts = await Product.find({
        _id: { $in: newLinkedProdIds },
        createdAt: { $lt: thirtyOneDaysAgo },
      }).select('_id').lean();

      if (expiredProducts.length > 0) {
        const expiredIds = expiredProducts.map(p => p._id);
        await ProductTag.deleteMany({
          productId: { $in: expiredIds },
          tagId: newTag._id,
        });
        await Product.updateMany(
          { _id: { $in: expiredIds } },
          { $set: { isNewArrival: false } }
        );
        if (standardTag) {
          for (const pId of expiredIds) {
            const hasStandard = await ProductTag.exists({ productId: pId, tagId: standardTag._id });
            if (!hasStandard) {
              await ProductTag.create({ productId: pId, tagId: standardTag._id });
            }
          }
        }
      }

      // 2. Sản phẩm trong vòng 31 ngày -> Gán Tag New, isNewArrival = true
      const recentProducts = await Product.find({
        status: 'active',
        createdAt: { $gte: thirtyOneDaysAgo },
      }).select('_id').lean();

      if (recentProducts.length > 0) {
        const recentIds = recentProducts.map(p => p._id);
        for (const pId of recentIds) {
          const hasNew = await ProductTag.exists({ productId: pId, tagId: newTag._id });
          if (!hasNew) {
            await ProductTag.create({ productId: pId, tagId: newTag._id });
          }
        }
        await Product.updateMany(
          { _id: { $in: recentIds } },
          { $set: { isNewArrival: true } }
        );

        // Luật loại trừ: hàng New không mang Standard (New = hàng mới, Standard = hàng cũ).
        // Gỡ Standard của đúng nhóm vừa gán New để vòng quét tự chữa lành mỗi chu kỳ.
        if (standardTag && recentIds.length > 0) {
          await ProductTag.deleteMany({ productId: { $in: recentIds }, tagId: standardTag._id });
        }
      }
    } catch (err) {
      console.warn('⚠️ [syncNewArrivalTags] Error:', err);
    }
  }

  static async getNewProducts(limit?: number): Promise<any[]> {
    const cacheKey = `products:new:tag:all:v2:${limit || 'unlimited'}`;
    try { const cached = await redis.get(cacheKey); if (cached) return JSON.parse(cached); } catch (err) {}

    // Đồng bộ quy tắc Tag New + vòng đời discount trung tâm, ngầm không chặn luồng API
    this.syncNewArrivalTags().catch(err => console.warn('syncNewArrivalTags error:', err));
    DiscountLifecycleService.syncAutoDiscounts().catch(err => console.warn('syncAutoDiscounts error:', err));

    const newTag = await Tag.findOne({
      status: 'active',
      $or: [{ slug: /^new$/i }, { name: /^sản phẩm mới$/i }],
    }).lean();

    if (!newTag) return [];

    // Chỉ lấy các sản phẩm có Tag New trong ProductTag
    const newLinks = await ProductTag.find({ tagId: newTag._id }).lean();
    const productIds = newLinks.map(l => l.productId);

    if (productIds.length === 0) return [];

    const fsProductIds = await FlashSaleService.getActiveFlashSaleProductIds();
    const limitedProductIds = await this.getProductIdsByTagSlugs(['limited', 'gioi-han', 'gioi-han-dac-biet']);
    const excludedIds = [...fsProductIds, ...limitedProductIds];

    const select = 'name brandId image variants categories discountPercentage discountStartDate discountEndDate soldCount createdAt status isNewArrival';
    const baseFilter: any = {
      _id: { $in: productIds, $nin: excludedIds },
      status: 'active',
    };

    let query = Product.find(baseFilter)
      .select(select)
      .populate('brandId')
      .populate('categories')
      .sort({ createdAt: -1 });

    if (limit && limit > 0) {
      query = query.limit(limit);
    }

    const productsRaw = await query.lean();
    const formatted = await formatMultipleProducts(productsRaw);

    // QUY TẮC: Sản phẩm trong Session "Sản Phẩm Mới Về" nếu có % giảm giá > 5% thì tự động chỉ hiện là 5%
    const products = formatted.map((p: any) => {
      const currentDiscount = p.discountPercentage || p.discount || 0;
      if (currentDiscount > 5) {
        const origPrice = p.originalPrice || p.price || 0;
        const newPrice = origPrice > 0 ? Math.round(origPrice * (1 - 5 / 100)) : p.price;
        return {
          ...p,
          discount: 5,
          discountPercentage: 5,
          price: newPrice,
        };
      }
      return p;
    });

    // Sắp xếp sản phẩm mới theo lượt bán từ Thấp -> Cao
    products.sort((a: any, b: any) => {
      const soldDiff = (a.soldCount || 0) - (b.soldCount || 0);
      if (soldDiff !== 0) return soldDiff;
      return (new Date(b.createdAt || 0).getTime()) - (new Date(a.createdAt || 0).getTime());
    });

    if (products.length > 0) { try { await redis.set(cacheKey, JSON.stringify(products), 'EX', this.CACHE_TTL); } catch (err) {} }
    return products;
  }

  private static lastSyncTrendingTime = 0;

  static async syncTrendingTags(): Promise<void> {
    const now = Date.now();
    // Giới hạn đồng bộ Tag Trending tối đa 1 lần mỗi 10 phút để giải phóng tải DB
    if (now - this.lastSyncTrendingTime < 600_000) return;
    this.lastSyncTrendingTime = now;

    try {
      const trendingTag = await Tag.findOne({
        status: 'active',
        $or: [{ slug: /^trending$/i }, { name: /^trending$/i }, { name: /^thịnh hành$/i }],
      }).lean();

      if (!trendingTag) return;

      const inStockProductIds = await ProductVariant.distinct('productId', { quantityInStock: { $gt: 0 } });

      // Lấy đúng TOP 16 sản phẩm CÒN HÀNG có lượt bán cao nhất toàn sàn
      const top16Products = await Product.find({
        status: 'active',
        _id: { $in: inStockProductIds },
      })
        .sort({ soldCount: -1, createdAt: -1 })
        .limit(16)
        .select('_id tag')
        .lean();

      const top16Ids = top16Products.map(p => p._id);

      // Xóa liên kết Tag Trending của các sản phẩm nằm ngoài Top 16
      await ProductTag.deleteMany({
        tagId: trendingTag._id,
        productId: { $nin: top16Ids },
      });

      // Tối ưu: Lấy danh sách đã tồn tại bằng 1 query duy nhất thay vì lặp 16 lần
      const existingTags = await ProductTag.find({
        tagId: trendingTag._id,
        productId: { $in: top16Ids },
      }).select('productId').lean();

      const existingSet = new Set(existingTags.map(t => t.productId.toString()));
      const toInsert = top16Ids
        .filter(pId => !existingSet.has(pId.toString()))
        .map(pId => ({ productId: pId, tagId: trendingTag._id }));

      if (toInsert.length > 0) {
        await ProductTag.insertMany(toInsert, { ordered: false }).catch(() => {});
      }
    } catch (err) {
      console.warn('⚠️ [syncTrendingTags] Error:', err);
    }
  }

  private static lastSyncLimitedTime = 0;

  static async syncLimitedTags(): Promise<void> {
    const now = Date.now();
    // Giới hạn đồng bộ Tag Limited tối đa 1 lần mỗi 10 phút để giải phóng tải DB
    if (now - this.lastSyncLimitedTime < 600_000) return;
    this.lastSyncLimitedTime = now;

    try {
      let limitedTag = await Tag.findOne({
        status: 'active',
        $or: [{ slug: /^limited$/i }, { name: /^limited$/i }, { name: /^phiên bản giới hạn$/i }],
      }).lean();

      if (!limitedTag) {
        limitedTag = await Tag.create({
          name: 'Limited',
          slug: 'limited',
          description: 'Phiên bản giới hạn số lượng độc quyền do section Sản phẩm giới hạn gán',
          status: 'active',
        });
      }

      const newTag = await Tag.findOne({
        status: 'active',
        $or: [{ slug: /^new$/i }, { name: /^sản phẩm mới$/i }],
      }).lean();

      const fsProductIds = await FlashSaleService.getActiveFlashSaleProductIds();

      // Kiểm tra các sản phẩm đã có tag Limited
      const existingLimitedLinks = await ProductTag.find({ tagId: limitedTag._id }).lean();
      let limitedProductIds = existingLimitedLinks.map(l => l.productId);

      if (limitedProductIds.length === 0) {
        // Section Sản phẩm giới hạn tự động chọn Top 16 sản phẩm đắt giá nhất còn hàng (dòng xa xỉ độc quyền)
        const inStockProductIds = await ProductVariant.distinct('productId', { quantityInStock: { $gt: 0 } });
        const topProducts = await Product.find({
          status: 'active',
          _id: { $in: inStockProductIds, $nin: fsProductIds },
        })
          .sort({ price: -1, createdAt: -1 })
          .limit(16)
          .select('_id')
          .lean();

        const topIds = topProducts.map(p => p._id);
        if (topIds.length > 0) {
          await ProductTag.insertMany(
            topIds.map(pId => ({ productId: pId, tagId: limitedTag!._id })),
            { ordered: false }
          ).catch(() => {});
          limitedProductIds = topIds;
        }
      }

      // Đảm bảo mọi sản phẩm mang tag Limited KHÔNG bao giờ có tag New
      if (newTag && limitedProductIds.length > 0) {
        await ProductTag.deleteMany({
          productId: { $in: limitedProductIds },
          tagId: newTag._id,
        });
        await Product.updateMany(
          { _id: { $in: limitedProductIds } },
          { $set: { isNewArrival: false } }
        );
      }
    } catch (err) {
      console.warn('⚠️ [syncLimitedTags] Error:', err);
    }
  }

  static async getLimitedProducts(): Promise<any[]> {
    const cacheKey = `products:limited:tag:v6`;
    try { const cached = await redis.get(cacheKey); if (cached) return JSON.parse(cached); } catch (err) {}
    
    // Tự động đồng bộ Tag Limited do section Sản phẩm giới hạn gán ngầm không chặn luồng API
    this.syncLimitedTags().catch(err => console.warn('syncLimitedTags error:', err));

    const fsProductIds = await FlashSaleService.getActiveFlashSaleProductIds();
    const productIds = await this.getProductIdsByTagSlugs(['limited', 'gioi-han', 'gioi-han-dac-biet']);
    let productsRaw: any[] = [];
    if (productIds.length > 0) {
      const filteredProductIds = productIds.filter(id => !fsProductIds.some(fsId => fsId.equals(id)));
      productsRaw = await Product.find({ _id: { $in: filteredProductIds }, status: 'active' })
        .populate('brandId')
        .populate('categories')
        .sort({ price: -1, createdAt: -1 })
        .limit(16)
        .lean();
    }
    const products = await formatMultipleProducts(productsRaw);
    products.sort((a, b) => (b.price || b.originalPrice || 0) - (a.price || a.originalPrice || 0));
    if (products.length > 0) { try { await redis.set(cacheKey, JSON.stringify(products), 'EX', this.CACHE_TTL); } catch (err) {} }
    return products;
  }

  static async getTrendingProducts(limit: number = 16): Promise<any[]> {
    const effectiveLimit = Math.min(16, limit > 0 ? limit : 16);
    const cacheKey = `products:trending:v11:${effectiveLimit}`;
    try { const cached = await redis.get(cacheKey); if (cached) return JSON.parse(cached); } catch (err) {}
    
    // Tự động đồng bộ Tag Trending ngầm không chặn luồng trả lời API
    this.syncTrendingTags().catch(err => console.warn('syncTrendingTags error:', err));

    const fsProductIds = await FlashSaleService.getActiveFlashSaleProductIds();
    // Lọc chỉ lấy các sản phẩm CÒN HÀNG (tồn tại ít nhất 1 variant có quantityInStock > 0)
    const inStockProductIds = await ProductVariant.distinct('productId', { quantityInStock: { $gt: 0 } });

    // Lấy top 16 sản phẩm bán chạy nhất còn hàng (sắp xếp giảm dần theo lượt bán).
    // Nếu sản phẩm nào trong top hết hàng, các sản phẩm tiếp theo còn hàng sẽ tự động cộng dồn lên thay thế vị trí đủ top 16.
    const baseFilter: any = {
      status: 'active',
      _id: { $in: inStockProductIds },
    };
    if (fsProductIds.length > 0) {
      baseFilter._id = { $in: inStockProductIds, $nin: fsProductIds };
    }

    const query = Product.find(baseFilter)
      .populate('brandId')
      .populate('categories')
      .sort({ soldCount: -1, createdAt: -1 })
      .limit(effectiveLimit);

    const productsRaw = await query.lean();

    const products = await formatMultipleProducts(productsRaw);
    if (products.length > 0) { try { await redis.set(cacheKey, JSON.stringify(products), 'EX', 300); } catch (err) {} }
    return products;
  }

  static async getPublicProducts(type: 'trending' | 'new' | 'limited', filters: any = {}): Promise<any[]> {
    const { brand, capacity, priceRange, minPrice, maxPrice, sortBy = 'newest', limit = 20, filterTag } = filters;
    const tagSlugsMap: Record<string, string[]> = { trending: ['trending', 'thinh-hanh', 'ban-chay', 'hot'], new: ['new', 'san-pham-moi'], limited: ['limited', 'gioi-han', 'gioi-han-dac-biet'] };
    let slugs = tagSlugsMap[type] || [];
    if (filterTag) {
      const additional = filterTag.split(',').map((s: string) => s.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean);
      for (const a of additional) { if (!slugs.includes(a)) slugs.push(a); }
    }
    if (!slugs || slugs.length === 0) return [];
    const cachePayload = { brand, capacity, priceRange, minPrice, maxPrice, sortBy, limit, filterTag };
    const cacheHash = crypto.createHash('md5').update(JSON.stringify(cachePayload)).digest('hex');
    const cacheKey = `products:public:v3:${type}:${cacheHash}`;
    try { const cached = await redis.get(cacheKey); if (cached) return JSON.parse(cached); } catch (err) { console.warn('Redis error in getPublicProducts:', err); }
    let productsRaw;
    if (type === 'trending') {
      const fsProductIds = await FlashSaleService.getActiveFlashSaleProductIds();
      const inStockProductIds = await ProductVariant.distinct('productId', { quantityInStock: { $gt: 0 } });
      const filter: any = {
        status: 'active',
        _id: { $in: inStockProductIds },
      };
      if (fsProductIds.length > 0) {
        filter._id = { $in: inStockProductIds, $nin: fsProductIds };
      }
      let query = Product.find(filter)
        .populate('brandId')
        .populate('categories')
        .sort({ soldCount: -1, createdAt: -1 });
      if (limit && limit > 0) {
        query = query.limit(Math.min(16, limit));
      }
      productsRaw = await query.lean();
    } else {
      let productIds = await this.getProductIdsByTagSlugs(slugs);
      if (type === 'new') {
        const newArrivals = await Product.find({ isNewArrival: true, status: 'active' }).select('_id').lean();
        const allIds = new Set([...productIds.map(id => id.toString()), ...newArrivals.map(p => p._id.toString())]);
        productIds = Array.from(allIds).map(id => new mongoose.Types.ObjectId(id));
      }
      if (productIds.length === 0) return [];
      productsRaw = await Product.find({ _id: { $in: productIds }, status: 'active' }).populate('brandId').populate('categories').sort({ createdAt: -1 }).lean();
    }
    const products = await formatMultipleProducts(productsRaw);
    const getActualPrice = (product: any) => { const p = product.price ?? 0; if (!p) return 0; let active = product.discountPercentage && product.discountPercentage > 0; if (active) { const now = new Date(); if (product.discountStartDate && new Date(product.discountStartDate) > now) active = false; if (product.discountEndDate && new Date(product.discountEndDate) < now) active = false; } return active ? Math.round(p * (1 - product.discountPercentage / 100)) : p; };
    const filtered = products.filter((product: any) => {
      if (brand && brand !== 'all') { const bName = (product.brand as any)?.name || (typeof product.brand === 'string' ? product.brand : '') || product.brandName || ''; if (bName.toLowerCase() !== brand.toLowerCase()) return false; }
      if (capacity && capacity !== 'all') { const parsedSizes = product.size ? product.size.split(',').map((s: string) => { const parts = s.trim().split(':'); return parts[0].trim().toLowerCase(); }).filter(Boolean) : []; if (!parsedSizes.includes(capacity.toLowerCase())) return false; }
      if (priceRange && priceRange !== 'all') { const actualPrice = getActualPrice(product); if (priceRange === 'under-1m' && actualPrice >= 1000000) return false; if (priceRange === '1m-3m' && (actualPrice < 1000000 || actualPrice > 3000000)) return false; if (priceRange === 'over-3m' && actualPrice <= 3000000) return false; }
      if (minPrice !== undefined || maxPrice !== undefined) { const actualPrice = getActualPrice(product); if (minPrice !== undefined && actualPrice < minPrice) return false; if (maxPrice !== undefined && actualPrice > maxPrice) return false; }
      return true;
    });
    if (sortBy === 'price-asc') filtered.sort((a: any, b: any) => getActualPrice(a) - getActualPrice(b));
    else if (sortBy === 'price-desc') filtered.sort((a: any, b: any) => getActualPrice(b) - getActualPrice(a));
    else if (sortBy === 'bestSeller') filtered.sort((a: any, b: any) => (b.soldCount || 0) - (a.soldCount || 0));
    else filtered.sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    const result = filtered.slice(0, limit);
    if (result.length > 0) { try { await redis.set(cacheKey, JSON.stringify(result), 'EX', this.CACHE_TTL); } catch (err) { console.warn('Redis set error:', err); } }
    return result;
  }

  static async getSaleProducts(): Promise<any[]> {
    const cacheKey = `products:sale:tag:v3`;
    try { const cached = await redis.get(cacheKey); if (cached) return JSON.parse(cached); } catch (err) { console.warn('Redis error in getSaleProducts:', err); }

    let flashSaleProducts: any[] = [];
    try {
      const activeFS = await FlashSaleService.getActiveFlashSale();
      if (activeFS && activeFS.items && activeFS.items.length > 0) {
        flashSaleProducts = activeFS.items
          .filter((it: any) => it.product || it.productId)
          .map((it: any) => {
            const p = it.product || it.productId;
            const extra = it.extraDiscountPercentage || 0;
            const baseDiscount = p.discountPercentage || p.discount || 0;
            const totalDiscount = Math.min(100, baseDiscount + extra);

            const rawBasePrice = p.originalPrice || (baseDiscount > 0 ? Math.round((p.price || 0) / (1 - baseDiscount / 100)) : (p.price || 0));
            const flashSalePrice = totalDiscount > 0 ? Math.round(rawBasePrice * (1 - totalDiscount / 100)) : rawBasePrice;

            return {
              ...p,
              price: flashSalePrice,
              originalPrice: rawBasePrice,
              discount: totalDiscount,
              discountPercentage: totalDiscount,
              isFlashSale: true,
              extraDiscountPercentage: extra,
              stockLimit: it.stockLimit || 0,
              soldCount: it.soldCount || 0,
            };
          });
      }
    } catch (fsErr) {
      console.warn('Error fetching Flash Sale active products:', fsErr);
    }

    const saleProductIds = await this.getProductIdsByTagSlugs(['sale', 'giam-gia']);
    const now = new Date();
    const discountFilter: any = { discountPercentage: { $gt: 0 }, discountEndDate: { $gt: now }, $or: [{ discountStartDate: null }, { discountStartDate: { $exists: false } }, { discountStartDate: { $lte: now } }] };
    let queryBase: any;
    if (saleProductIds.length > 0) {
      queryBase = { _id: { $in: saleProductIds }, status: 'active', ...discountFilter };
    } else {
      queryBase = { status: 'active', ...discountFilter };
    }
    let productsRaw: any[] = [];
    if (await Product.countDocuments(queryBase).maxTimeMS(3000)) {
      productsRaw = await Product.find(queryBase).populate('brandId').populate('categories').sort({ discountEndDate: 1, createdAt: -1 }).limit(12).lean();
    }
    const regularProducts = await formatMultipleProducts(productsRaw);

    const existingIds = new Set(flashSaleProducts.map((p: any) => p._id?.toString()));
    const filteredRegular = regularProducts.filter((p: any) => !existingIds.has(p._id?.toString()));
    const finalProducts = [...flashSaleProducts, ...filteredRegular];

    if (finalProducts.length > 0) {
      try { await redis.set(cacheKey, JSON.stringify(finalProducts), 'EX', this.CACHE_TTL); } catch (err) { console.warn('Redis set error:', err); }
    }
    return finalProducts;
  }

  static async getSeasonalProducts(limit: number = 200): Promise<any[]> {
    const effectiveLimit = Math.min(200, limit > 0 ? limit : 200);
    const cacheKey = `products:seasonal:v7:${effectiveLimit}`;
    try { const cached = await redis.get(cacheKey); if (cached) return JSON.parse(cached); } catch (err) {}

    // Lọc các sản phẩm CÒN HÀNG và có thông tin mùa của toàn bộ các Tag (New, Limited, Trending, Standard...)
    // Tương tự như HOT TREND: Sử dụng dữ liệu gốc của sản phẩm, không ép/sửa đổi dữ liệu, chỉ lọc theo Season
    const inStockProductIds = await ProductVariant.distinct('productId', { quantityInStock: { $gt: 0 } });

    const baseFilter: any = {
      status: 'active',
      _id: { $in: inStockProductIds },
      $or: [
        { 'specifications.season': { $exists: true, $ne: '' } },
        { season: { $exists: true, $ne: '' } },
      ],
    };

    const productsRaw = await Product.find(baseFilter)
      .populate('brandId')
      .populate('categories')
      .sort({ soldCount: -1, createdAt: -1 })
      .limit(effectiveLimit)
      .lean();

    const products = await formatMultipleProducts(productsRaw);
    if (products.length > 0) {
      try { await redis.set(cacheKey, JSON.stringify(products), 'EX', 300); } catch (err) {}
    }
    return products;
  }

  static async getAllProducts(options: any = {}): Promise<{ items: any[]; total: number; page: number; totalPages: number }> {
    const { page = 1, limit = 25, search, brand, tag, category, sortBy, status, minPrice, maxPrice } = options;
    // Khi sortBy=outOfStock, treat as stock filter
    const stock = sortBy === 'outOfStock' ? 'outOfStock' : options.stock;
    const query: any = {};
    if (search) {
      const cleanSearch = search.trim();
      const escapedSearch = cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matchingVariants = await ProductVariant.find({ sku: { $regex: escapedSearch, $options: 'i' } }).select('productId').lean();
      const variantProductIds = matchingVariants.map((v: any) => v.productId).filter(Boolean);
      const matchingBrands = await Brand.find({ name: { $regex: escapedSearch, $options: 'i' } }).select('_id').lean();
      const brandIds = matchingBrands.map((b: any) => b._id);
      const searchOr: any[] = [
        { name: { $regex: escapedSearch, $options: 'i' } }
      ];
      if (variantProductIds.length > 0) {
        searchOr.push({ _id: { $in: variantProductIds.map((id: any) => new mongoose.Types.ObjectId(id.toString())) } });
      }
      if (brandIds.length > 0) {
        searchOr.push({ brandId: { $in: brandIds } });
      }
      query.$or = searchOr;
    }
    if (status) { query.status = status; }
    if (brand) {
      const brandIds = brand.split(',').map((s: string) => s.trim()).filter(Boolean);
      const validBrandIds = brandIds.filter((id: string) => /^[0-9a-fA-F]{24}$/.test(id));
      if (validBrandIds.length > 0) {
        query.brandId = { $in: validBrandIds.map((id: string) => new mongoose.Types.ObjectId(id)) };
      } else {
        const brandDoc = await Brand.findOne({ name: { $regex: `^${brand.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
        if (brandDoc) { query.brandId = brandDoc._id; } else { return { items: [], total: 0, page, totalPages: 0 }; }
      }
    }
    if (stock === 'inStock' || stock === 'lowStock' || stock === 'outOfStock') {
      // Stock is stored on ProductVariant, not Product. Aggregate total stock per product from variants.
      let stockAggregation: any[];
      try {
        stockAggregation = await ProductVariant.aggregate([
          { $group: { _id: '$productId', totalStock: { $sum: { $ifNull: ['$quantityInStock', 0] } } } },
          {
            $match: stock === 'inStock'
              ? { totalStock: { $gt: 0 } }
              : stock === 'lowStock'
                ? { totalStock: { $gt: 0, $lt: 10 } }
                : { totalStock: 0 },
          },
        ]);
      } catch (err) {
        console.error('Stock aggregation error:', err);
        throw new Error('Không thể lọc tồn kho: ' + (err as any).message);
      }
      const stockProductIds = stockAggregation
        .map((s: any) => s._id)
        .filter((id: any) => id && mongoose.Types.ObjectId.isValid(id.toString()))
        .map((id: any) => new mongoose.Types.ObjectId(id.toString()));
      if (stockProductIds.length === 0) {
        return { items: [], total: 0, page, totalPages: 0 };
      }
      if (query._id) {
        // query._id could be { $in: [...] } or just a single ObjectId
        const existingIds = query._id.$in ? query._id.$in : (Array.isArray(query._id) ? query._id : [query._id]);
        const existingStrIds = existingIds.map((id: any) => (id && id.toString ? id.toString() : String(id)));
        const stockStrIds = stockProductIds.map((id: any) => id.toString());
        const merged = existingStrIds.filter((id: string) => stockStrIds.includes(id));
        if (merged.length === 0) {
          return { items: [], total: 0, page, totalPages: 0 };
        }
        query._id = { $in: merged.map((id: string) => new mongoose.Types.ObjectId(id)) };
      } else {
        query._id = { $in: stockProductIds };
      }
    }
    let isTrending = false;
    if (tag && tag !== 'all') {
      const isSaleTag = ['sale', 'flash-sale', 'giam-gia'].includes(tag.toLowerCase());
      const isNewTag = ['new', 'san-pham-moi', 'moi'].includes(tag.toLowerCase());
      const isTrendingTag = ['trending', 'thinh-hanh', 'ban-chay', 'hot'].includes(tag.toLowerCase());
      isTrending = isTrendingTag;
      let productIds: mongoose.Types.ObjectId[] = [];

      if (isSaleTag) {
        // Chỉ lấy các sản phẩm được gán trực tiếp vào sự kiện Flash Sale đang diễn ra (Active)
        productIds = await FlashSaleService.getActiveFlashSaleProductIds();
      } else if (isNewTag) {
        // Sản phẩm mới: chỉ lấy các sản phẩm tạo trong vòng 31 ngày gần nhất
        const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
        const newProducts = await Product.find({
          status: 'active',
          createdAt: { $gte: thirtyOneDaysAgo },
        }).select('_id').lean();
        productIds = newProducts.map(p => p._id);
      } else if (isTrendingTag) {
        // Trending: Lấy các sản phẩm còn hàng có lượt mua cao nhất giảm dần
        const inStockProductIds = await ProductVariant.distinct('productId', { quantityInStock: { $gt: 0 } });
        const trendingProds = await Product.find({
          status: 'active',
          _id: { $in: inStockProductIds },
        })
          .sort({ soldCount: -1, createdAt: -1 })
          .select('_id')
          .lean();
        productIds = trendingProds.map(p => p._id);
      } else {
        const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const orConditions: any[] = [
          { slug: { $regex: `^${escapedTag}$`, $options: 'i' } },
          { name: { $regex: `^${escapedTag}$`, $options: 'i' } },
        ];
        if (mongoose.Types.ObjectId.isValid(tag)) {
          orConditions.push({ _id: new mongoose.Types.ObjectId(tag) });
        }
        const tagDoc = await Tag.findOne({ status: 'active', $or: orConditions });
        if (tagDoc) {
          const productLinks = await ProductTag.find({ tagId: tagDoc._id }).lean();
          productIds = productLinks.map(l => l.productId);
        }
      }

      const uniqueProductIds = Array.from(new Set(productIds.map(id => id.toString())))
        .map(id => new mongoose.Types.ObjectId(id));

      if (uniqueProductIds.length === 0) {
        return { items: [], total: 0, page, totalPages: 0 };
      }

      if (query._id) {
        const existingIds = query._id.$in ? query._id.$in : (Array.isArray(query._id) ? query._id : [query._id]);
        const existingStrIds = existingIds.map((id: any) => (id && id.toString ? id.toString() : String(id)));
        const tagStrIds = uniqueProductIds.map((id: any) => id.toString());
        const merged = existingStrIds.filter((id: string) => tagStrIds.includes(id));
        if (merged.length === 0) {
          return { items: [], total: 0, page, totalPages: 0 };
        }
        query._id = { $in: merged.map((id: string) => new mongoose.Types.ObjectId(id)) };
      } else {
        query._id = { $in: uniqueProductIds };
      }
    }
    if (category) {
      const categoryInputs = category.split(',').map((s: string) => s.trim()).filter(Boolean);
      const validCategoryIds: mongoose.Types.ObjectId[] = [];
      const categoryNames: string[] = [];

      for (const input of categoryInputs) {
        if (mongoose.Types.ObjectId.isValid(input)) {
          validCategoryIds.push(new mongoose.Types.ObjectId(input));
        } else {
          categoryNames.push(input);
        }
      }

      if (categoryNames.length > 0) {
        const foundCategories = await Category.find({
          name: { $in: categoryNames.map(name => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) }
        }).select('_id').lean();
        for (const catDoc of foundCategories) {
          validCategoryIds.push(new mongoose.Types.ObjectId(catDoc._id.toString()));
        }
      }

      if (validCategoryIds.length > 0) {
        query.$and = query.$and || [];
        const catConditions = validCategoryIds.map((id: mongoose.Types.ObjectId) => ({
          $or: [{ categories: id }, { categoryId: id }]
        }));
        query.$and.push({ $or: catConditions });
      } else {
        return { items: [], total: 0, page, totalPages: 0 };
      }
    }
    let sort: any = (isTrending && !sortBy) ? { soldCount: -1, createdAt: -1 } : { createdAt: -1 };
    let stockSortNeeded = false;
    let stockSortAsc = true;
    let priceSortNeeded = false;
    let priceSortAsc = true;
    // When stock filter is active, auto-sort by stock descending (high → low)
    // Must be set AFTER variable declaration
    if (stock === 'inStock' || stock === 'lowStock' || stock === 'outOfStock') {
      stockSortNeeded = true;
      stockSortAsc = false;
    }
    switch (sortBy) {
      case 'priceAsc': priceSortNeeded = true; priceSortAsc = true; break;
      case 'priceDesc': priceSortNeeded = true; priceSortAsc = false; break;
      case 'stockAsc': stockSortNeeded = true; stockSortAsc = true; break;
      case 'stockDesc': stockSortNeeded = true; stockSortAsc = false; break;
      case 'rating': sort = { rating: -1, reviewsCount: -1 }; break;
      case 'newest': sort = { createdAt: -1 }; break;
      case 'oldest': sort = { createdAt: 1 }; break;
      case 'bestSeller': sort = { soldCount: -1, createdAt: -1 }; break;
      case 'nameAsc': sort = { name: 1 }; break;
      case 'nameDesc': sort = { name: -1 }; break;
    }
    let total: number;
    let products: any[];
    let items: any[];

    if (minPrice || maxPrice) {
      // Price filter: fetch matching documents, format once, filter by price and slice page items
      const all = await Product.find(query)
        .select('name slug brandId image variants categories discountPercentage discountStartDate discountEndDate soldCount createdAt status season specifications')
        .populate('brandId')
        .populate('categories')
        .sort(sort)
        .lean();
      const formatted = await formatMultipleProducts(all);
      const min = parseFloat(minPrice) || 0;
      const max = parseFloat(maxPrice) || Infinity;
      const matched = formatted.filter((p: any) => {
        const price = p.price ?? 0;
        return price >= min && price <= max;
      });
      total = matched.length;
      items = matched.slice((page - 1) * limit, page * limit);
    } else {
      try {
        total = await Product.countDocuments(query);
        products = await Product.find(query).select('name slug brandId image variants categories discountPercentage discountStartDate discountEndDate soldCount createdAt status season specifications').populate('brandId').populate('categories').sort(sort).skip((page - 1) * limit).limit(limit).lean();
      } catch (err) {
        console.error('Product query error:', err, 'query:', JSON.stringify(query));
        throw new Error('Lỗi truy vấn sản phẩm: ' + (err as any).message);
      }
      items = await formatMultipleProducts(products);
    }

    // Stock sort must happen post-query because quantityInStock is computed from variants in formatMultipleProducts
    if (stockSortNeeded) {
      items = [...items].sort((a: any, b: any) => {
        const stockA = a.quantityInStock ?? 0;
        const stockB = b.quantityInStock ?? 0;
        return stockSortAsc ? stockA - stockB : stockB - stockA;
      });
    }

    // Price sort must happen post-query because discount is applied in formatMultipleProducts
    // Sorting by raw `price` field would ignore discounts, giving wrong order
    if (priceSortNeeded) {
      const getActualPrice = (p: any) => {
        const basePrice = p.price ?? 0;
        if (p.discount && p.discount > 0) return Math.round(basePrice * (1 - p.discount / 100));
        return basePrice;
      };
      items = [...items].sort((a: any, b: any) => {
        return priceSortAsc ? getActualPrice(a) - getActualPrice(b) : getActualPrice(b) - getActualPrice(a);
      });
    }

    return { items, total, page, totalPages: Math.ceil(total / limit) };
  }

  static async getBulkProducts(ids: string[]): Promise<any[]> {
    if (!ids.length) return [];
    const validIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id)).slice(0, 20).map(id => new mongoose.Types.ObjectId(id));
    if (!validIds.length) return [];
    const productsRaw = await Product.find({ _id: { $in: validIds }, status: 'active' })
      .select('name slug brandId image images thumbnail variants categories price originalPrice original_price discountPercentage discountStartDate discountEndDate soldCount createdAt status')
      .populate('brandId')
      .populate('categories')
      .lean();
    return formatMultipleProducts(productsRaw);
  }

  static async suggestProducts(query: string, limit: number = 8): Promise<{ products: any[]; brands: any[] }> {
    if (!query || !query.trim()) {
      const randomProducts = await Product.aggregate([{ $match: { status: 'active' } }, { $sample: { size: limit } }, { $lookup: { from: 'brands', localField: 'brandId', foreignField: '_id', as: 'brand' } }, { $unwind: { path: '$brand', preserveNullAndEmptyArrays: true } }, { $project: { name: 1, image: 1, brand: '$brand.name' } }]);
      const formatted = await formatMultipleProducts(randomProducts);
      return { products: formatted.map((p: any) => ({ _id: p._id, name: p.name, price: p.price, image: p.image || '', brand: p.brand || '' })), brands: [] };
    }
    const cleanQuery = query.trim();
    const cacheKey = `products:suggest:v3:${cleanQuery.toLowerCase()}`;
    try { const cached = await redis.get(cacheKey); if (cached) return JSON.parse(cached); } catch (err) { console.warn('Redis error in suggestProducts:', err); }

    // Tìm brand bằng regex (linh hoạt cho autocomplete, không phụ thuộc text index)
    const escaped = cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');

    const matchingBrands = await Brand.find({
      status: 'active',
      name: { $regex: regex }
    }).limit(6).lean();
    const brandIds = matchingBrands.map(b => b._id);

    // Tìm product bằng tên sản phẩm HOẶC thuộc thương hiệu khớp
    const productConditions: any[] = [
      { name: { $regex: regex } }
    ];
    if (brandIds.length > 0) {
      productConditions.push({ brandId: { $in: brandIds } });
    }

    const productsRaw = await Product.find({
      status: 'active',
      $or: productConditions,
    })
      .populate('brandId', 'name')
      .limit(limit)
      .lean();

    const formatted = await formatMultipleProducts(productsRaw);
    const result = {
      products: formatted.map((p: any) => ({ _id: p._id, name: p.name, price: p.price, originalPrice: p.originalPrice || p.price, discount: p.discount || 0, image: p.image || '', brand: p.brand || '' })),
      brands: matchingBrands.map((b: any) => ({ _id: b._id, name: b.name, logo: b.logo || '' }))
    };
    if (result.products.length > 0 || result.brands.length > 0) { try { await redis.set(cacheKey, JSON.stringify(result), 'EX', 300); } catch (err) { console.warn('Redis set error in suggestProducts:', err); } }
    return result;
  }

  static async getProductById(id: string): Promise<any | null> {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;

    const cacheKey = `product:detail:${id}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (err) {
      console.warn('Redis get error in getProductById:', err);
    }

    const product = await Product.findOne({ _id: id, status: 'active' }).populate('brandId').populate('categories').lean();
    if (!product) return null;

    const variantIds = (product.variants || []) as mongoose.Types.ObjectId[];
    const oldCatId = !(product.categories as any[])?.length ? (product as any).categoryId : null;

    // Chạy song song 6 truy vấn độc lập
    const [images, variants, tagLinks, catDoc, activeFS, reviewStats] = await Promise.all([
      ProductImage.find({ productId: id }).lean(),
      variantIds.length > 0
        ? ProductVariant.find({ _id: { $in: variantIds } }).sort({ sortOrder: 1 }).lean()
        : Promise.resolve([]),
      ProductTag.find({ productId: id }).populate({ path: 'tagId', model: 'Tag', select: 'name slug status' }).lean(),
      oldCatId ? Category.findById(oldCatId).lean().catch(() => null) : Promise.resolve(null),
      FlashSale.findOne({
        status: { $in: ['active', 'scheduled'] },
        'items.productId': new mongoose.Types.ObjectId(id),
      }).lean(),
      Review.aggregate([
        { $match: { productId: new mongoose.Types.ObjectId(id), status: 'visible' } },
        { $group: { _id: null, count: { $sum: 1 }, avg: { $avg: '$rating' } } },
      ]),
    ]);

    const rawTagSlugs = tagLinks
      .filter(l => (l.tagId as any)?.status === 'active')
      .map(l => (l.tagId as any)?.slug)
      .filter(Boolean);

    const productTag = rawTagSlugs.join(', ') || (product as any).tag || '';

    const oldCatName = catDoc ? catDoc.name : '';
    const reviewsCount = reviewStats.length > 0 ? reviewStats[0].count : 0;
    const avgRating = reviewStats.length > 0 ? Math.round(reviewStats[0].avg * 10) / 10 : 0;

    const defaultVariant = getDefaultVariant(variants) || variants[0];
    const rawVariantPrice = defaultVariant?.price || (product as any).price || (product as any).originalPrice || 0;

    let extraDiscount = 0;
    let fsStockLimit = 0;
    let fsSoldCount = 0;
    let isFS = false;

    if (activeFS) {
      const fsItem = (activeFS.items || []).find((it: any) => it.productId?.toString() === id.toString());
      if (fsItem) {
        extraDiscount = fsItem.extraDiscountPercentage || 0;
        fsStockLimit = fsItem.stockLimit || 0;
        fsSoldCount = fsItem.soldCount || 0;
        isFS = true;
      }
    }

    const quantityInStock = variants.length > 0
      ? variants.reduce((sum: number, v: any) => sum + (v.quantityInStock || 0), 0)
      : ((product as any).quantityInStock ?? (product as any).stock ?? 1);

    const baseDiscount = (product as any).discountPercentage || (product as any).discount || 0;
    const totalDiscount = Math.min(100, baseDiscount + extraDiscount);
    let computedPrice = rawVariantPrice;
    if (computedPrice > 0 && totalDiscount > 0) {
      computedPrice = Math.round(rawVariantPrice * (1 - totalDiscount / 100));
    }

    const catStr = resolveCategoryNames(product, undefined, oldCatName);
    const catArr = catStr ? catStr.split(',').map(s => s.trim()).filter(Boolean) : [];

    const result = {
      ...product,
      price: computedPrice,
      originalPrice: rawVariantPrice,
      discount: totalDiscount,
      discountPercentage: totalDiscount,
      stockLimit: fsStockLimit,
      soldCount: isFS ? fsSoldCount : ((product as any).soldCount || 0),
      isFlashSale: isFS,
      brand: (product.brandId as any)?.name || '',
      categories: catArr,
      image: images[0]?.url || '',
      images: images.slice(1).map(img => img.url),
      variants: variants.map(v => {
        const num = parseInt(String(v.size || '').replace(/\D/g, ''), 10) || 0;
        const vType = (v as any).type === 'decant' || (v as any).type === 'fullbox'
          ? (v as any).type
          : (num > 0 && num < 50 ? 'decant' : 'fullbox');
        return {
          _id: v._id,
          size: v.size,
          type: vType,
          price: v.price,
          originalPrice: v.price,
          quantityInStock: v.quantityInStock,
          sku: v.sku,
          isDefault: v.isDefault,
        };
      }),
      defaultVariantSize: defaultVariant?.size || '100ml',
      size: variants.map(v => `${v.size}:${v.price}`).join(', '),
      tag: productTag,
      quantityInStock,
      reviewsCount,
      avgRating,
      rating: avgRating,
    };

    try {
      await redis.set(cacheKey, JSON.stringify(result), 'EX', this.CACHE_TTL);
    } catch (err) {
      console.warn('Redis set error in getProductById:', err);
    }

    return result;
  }

  static async getProductByIdAdmin(id: string): Promise<any | null> {
    const product = await Product.findOne({ _id: id }).populate('brandId').populate('categories').lean();
    if (!product) return null;

    const variantIds = (product.variants || []) as mongoose.Types.ObjectId[];
    const oldCatId = !(product.categories as any[])?.length ? (product as any).categoryId : null;

    const [images, variants, tagLinks, catDoc, stats] = await Promise.all([
      ProductImage.find({ productId: id }).lean(),
      variantIds.length > 0
        ? ProductVariant.find({ _id: { $in: variantIds } }).sort({ sortOrder: 1 }).lean()
        : Promise.resolve([]),
      ProductTag.find({ productId: id }).populate({ path: 'tagId', model: 'Tag', select: 'name slug' }).lean(),
      oldCatId ? Category.findById(oldCatId).lean().catch(() => null) : Promise.resolve(null),
      Review.aggregate([
        { $match: { productId: new mongoose.Types.ObjectId(id), status: 'visible' } },
        { $group: { _id: null, count: { $sum: 1 }, avg: { $avg: '$rating' } } },
      ]),
    ]);

    const tagSlugs = tagLinks.map(l => (l.tagId as any)?.slug).filter(Boolean);
    const oldCatName = catDoc ? catDoc.name : '';
    const reviewsCount = stats[0]?.count || 0;
    const avgRating = stats[0]?.avg ? Math.round(stats[0].avg * 10) / 10 : 0;

    const variant50ml = variants.find((v: any) => v.size === '50ml') || variants[0];
    let computedPrice = variant50ml?.price || 0;
    if (computedPrice > 0 && (product as any).discountPercentage > 0) {
      const now = new Date();
      const startOk = !(product as any).discountStartDate || new Date((product as any).discountStartDate) <= now;
      const endOk = !(product as any).discountEndDate || new Date((product as any).discountEndDate) >= now;
      if (startOk && endOk) computedPrice = Math.round(computedPrice * (1 - (product as any).discountPercentage / 100));
    }

    const catStr = resolveCategoryNames(product, undefined, oldCatName);
    const catArr = catStr ? catStr.split(',').map(s => s.trim()).filter(Boolean) : [];

    // ── Sold count ──
    const variantObjectIds = variants.map((v: any) => v._id);
    let totalSold = 0;
    try {
      const soldAgg = await OrderItem.aggregate([
        { $match: { variantId: { $in: variantObjectIds }, status: { $ne: 'cancelled' } } },
        { $group: { _id: null, total: { $sum: '$quantity' } } },
      ]);
      totalSold = soldAgg[0]?.total || 0;
    } catch (_) {}

    const specs = product.specifications || {};

    const imageUrls = images.map(i => i.url);
    const mainImage = imageUrls[0] || product.image || '';

    return {
      ...product,
      specifications: specs,
      longevity: specs.longevity || (product as any).longevity || '',
      sillage: specs.sillage || (product as any).sillage || '',
      scentTrail: specs.scentTrail || (product as any).scentTrail || '',
      style: specs.style || (product as any).style || '',
      suitableFor: specs.suitableFor || (product as any).suitableFor || '',
      occasion: specs.occasion || (product as any).occasion || '',
      season: specs.season || (product as any).season || '',
      time: specs.time || (product as any).time || '',
      image: mainImage,
      images: imageUrls,
      categories: catArr,
      variants: variants.map((v: any) => ({
        _id: v._id,
        size: v.size,
        price: v.price,
        quantityInStock: v.quantityInStock ?? 0,
        isDefault: v.isDefault ?? false,
      })),
      price: computedPrice,
      size: variants.map(v => `${v.size}:${v.price}:${v.quantityInStock || 0}`).join(', '),
      tag: tagSlugs.join(', '),
      quantityInStock: variants.reduce((sum, v) => sum + (v.quantityInStock || 0), 0),
      reviewsCount,
      avgRating,
      rating: avgRating,
    };
  }
}
