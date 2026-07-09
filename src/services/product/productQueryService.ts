import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Product } from '../../models/Product.ts';
import { redis } from '../../config/redis.ts';
import { Brand } from '../../models/Brand.ts';
import { Tag } from '../../models/Tag.ts';
import { ProductTag } from '../../models/ProductTag.ts';
import { Category } from '../../models/Category.ts';
import { ProductImage } from '../../models/ProductImage.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { formatMultipleProducts } from './productFormatterService.ts';
import { resolveCategoryNames } from './productHelpers.ts';

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
      const allTags = await Tag.find({}).lean();
      for (const tag of allTags) {
        const slug = (tag.slug || '').toLowerCase();
        if (!this.tagCache.has(slug)) {
          this.tagCache.set(slug, tag._id);
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

  static async getNewProducts(): Promise<any[]> {
    const cacheKey = `products:new:tag:v3`;
    try { const cached = await redis.get(cacheKey); if (cached) return JSON.parse(cached); } catch (err) { console.warn('Redis error in getNewProducts:', err); }
    const productIds = await this.getProductIdsByTagSlugs(['new', 'san-pham-moi']);
    const select = 'name brandId image variants categories discountPercentage discountStartDate discountEndDate soldCount createdAt';
    let productsRaw;
    if (productIds.length > 0) {
      productsRaw = await Product.find({ _id: { $in: productIds } }).select(select).populate('brandId').populate('categories').sort({ createdAt: -1 }).limit(15).lean();
    } else {
      productsRaw = await Product.find({}).select(select).populate('brandId').populate('categories').sort({ createdAt: -1 }).limit(15).lean();
    }
    const products = await formatMultipleProducts(productsRaw);
    if (products.length > 0) { try { await redis.set(cacheKey, JSON.stringify(products), 'EX', this.CACHE_TTL); } catch (err) { console.warn('Redis set error:', err); } }
    return products;
  }

  static async getLimitedProducts(): Promise<any[]> {
    const cacheKey = `products:limited:tag:v2`;
    try { const cached = await redis.get(cacheKey); if (cached) return JSON.parse(cached); } catch (err) { console.warn('Redis error in getLimitedProducts:', err); }
    const productIds = await this.getProductIdsByTagSlugs(['limited', 'gioi-han', 'gioi-han-dac-biet']);
    let productsRaw;
    if (productIds.length > 0) {
      productsRaw = await Product.find({ _id: { $in: productIds } }).populate('brandId').populate('categories').sort({ createdAt: -1 }).limit(15).lean();
    } else {
      productsRaw = await Product.find({}).populate('brandId').populate('categories').sort({ createdAt: -1 }).limit(15).lean();
    }
    const products = await formatMultipleProducts(productsRaw);
    if (products.length > 0) { try { await redis.set(cacheKey, JSON.stringify(products), 'EX', this.CACHE_TTL); } catch (err) { console.warn('Redis set error:', err); } }
    return products;
  }

  static async getTrendingProducts(): Promise<any[]> {
    const cacheKey = `products:trending:tag:v3`;
    try { const cached = await redis.get(cacheKey); if (cached) return JSON.parse(cached); } catch (err) { console.warn('Redis error in getTrendingProducts:', err); }
    const productIds = await this.getProductIdsByTagSlugs(['trending', 'thinh-hanh', 'ban-chay', 'hot']);
    let productsRaw;
    if (productIds.length > 0) {
      productsRaw = await Product.find({ _id: { $in: productIds } }).populate('brandId').populate('categories').sort({ createdAt: -1 }).limit(15).lean();
    } else {
      productsRaw = await Product.find({}).populate('brandId').populate('categories').sort({ soldCount: -1, createdAt: -1 }).limit(15).lean();
    }
    const products = await formatMultipleProducts(productsRaw);
    if (products.length > 0) { try { await redis.set(cacheKey, JSON.stringify(products), 'EX', this.CACHE_TTL); } catch (err) { console.warn('Redis set error:', err); } }
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
    const cacheKey = `products:public:${type}:${cacheHash}`;
    try { const cached = await redis.get(cacheKey); if (cached) return JSON.parse(cached); } catch (err) { console.warn('Redis error in getPublicProducts:', err); }
    const productIds = await this.getProductIdsByTagSlugs(slugs);
    if (productIds.length === 0) return [];
    const productsRaw = await Product.find({ _id: { $in: productIds } }).populate('brandId').populate('categories').sort({ createdAt: -1 }).lean();
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
    const cacheKey = `products:sale:tag`;
    try { const cached = await redis.get(cacheKey); if (cached) return JSON.parse(cached); } catch (err) { console.warn('Redis error in getSaleProducts:', err); }
    const saleProductIds = await this.getProductIdsByTagSlugs(['sale', 'giam-gia']);
    const now = new Date();
    const discountFilter: any = { discountPercentage: { $gt: 0 }, discountEndDate: { $gt: now }, $or: [{ discountStartDate: null }, { discountStartDate: { $exists: false } }, { discountStartDate: { $lte: now } }] };
    let queryBase: any;
    if (saleProductIds.length > 0) {
      queryBase = { _id: { $in: saleProductIds }, ...discountFilter };
    } else {
      queryBase = { ...discountFilter };
    }
    let productsRaw: any[] = [];
    if (await Product.countDocuments(queryBase).maxTimeMS(3000)) { productsRaw = await Product.find(queryBase).populate('brandId').populate('categories').sort({ discountEndDate: 1, createdAt: -1 }).limit(12)  
.lean(); }
    const products = await formatMultipleProducts(productsRaw);
    if (products.length > 0) { try { await redis.set(cacheKey, JSON.stringify(products), 'EX', this.CACHE_TTL); } catch (err) { console.warn('Redis set error:', err); } }
    return products;
  }

  static async getAllProducts(options: any = {}): Promise<{ items: any[]; total: number; page: number; totalPages: number }> {
    const { page = 1, limit = 25, search, brand, stock, tag, category, sortBy } = options;
    const query: any = {};
    if (search) { query.$text = { $search: search }; }
    if (brand) { const brandDoc = await Brand.findOne({ name: { $regex: `^${brand.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }); if (brandDoc) { query.brandId = brandDoc._id; } else { return { items: [], total: 0, page, totalPages: 0 }; } }
    if (stock === 'inStock' || stock === 'lowStock' || stock === 'outOfStock') {
      // Stock is stored on ProductVariant, not Product. Aggregate total stock per product from variants.
      const stockAggregation = await ProductVariant.aggregate([
        { $group: { _id: '$productId', totalStock: { $sum: '$quantityInStock' } } },
        {
          $match: stock === 'inStock'
            ? { totalStock: { $gt: 0 } }
            : stock === 'lowStock'
              ? { totalStock: { $gt: 0, $lt: 10 } }
              : { totalStock: 0 },
        },
      ]);
      const stockProductIds = stockAggregation.map((s: any) => s._id);
      if (stockProductIds.length === 0) {
        return { items: [], total: 0, page, totalPages: 0 };
      }
      if (query._id) {
        const existingIds = query._id.$in ? query._id.$in : [query._id];
        query._id = { $in: existingIds.filter((id: any) => stockProductIds.some((pid: any) => pid.equals(id))) };
      } else {
        query._id = { $in: stockProductIds };
      }
    }
    if (tag && tag !== 'all') { const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const tagDoc = await Tag.findOne({ $or: [{ slug: { $regex: `^${escapedTag}$`, $options: 'i' } }, { name: { $regex: `^${escapedTag}$`, $options: 'i' } }] }); if (tagDoc) { const productLinks = await ProductTag.find({ tagId: tagDoc._id }).lean(); const productIds = productLinks.map(l => l.productId); if (productIds.length === 0) { return { items: [], total: 0, page, totalPages: 0 }; } if (query._id) { const existingIds = query._id.$in ? query._id.$in : [query._id]; query._id = { $in: existingIds.filter((id: any) => productIds.some((pid: any) => pid.equals(id))) }; } else { query._id = { $in: productIds }; } } else { return { items: [], total: 0, page, totalPages: 0 }; } }
    if (category) { const categoryDoc = await Category.findOne({ name: { $regex: `^${category.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }); if (categoryDoc) { query.$and = query.$and || []; query.$and.push({ $or: [{ categories: categoryDoc._id }, { categoryId: categoryDoc._id }] }); } else { return { items: [], total: 0, page, totalPages: 0 }; } }
    let sort: any = { createdAt: -1 };
    let stockSortNeeded = false;
    let stockSortAsc = true;
    switch (sortBy) {
      case 'priceAsc': sort = { price: 1 }; break;
      case 'priceDesc': sort = { price: -1 }; break;
      case 'stockAsc': stockSortNeeded = true; stockSortAsc = true; break;
      case 'stockDesc': stockSortNeeded = true; stockSortAsc = false; break;
      case 'rating': sort = { rating: -1, reviewsCount: -1 }; break;
      case 'newest': sort = { createdAt: -1 }; break;
      case 'bestSeller': sort = { soldCount: -1, createdAt: -1 }; break;
    }
    const total = await Product.countDocuments(query);
    const products = await Product.find(query).select('name brandId image variants categories discountPercentage discountStartDate discountEndDate soldCount createdAt').populate('brandId').populate('categories').sort(sort).skip((page - 1) * limit).limit(limit).lean()
    
    let items = await formatMultipleProducts(products);

    // Stock sort must happen post-query because quantityInStock is computed from variants in formatMultipleProducts
    if (stockSortNeeded) {
      items = [...items].sort((a: any, b: any) => {
        const stockA = a.quantityInStock ?? 0;
        const stockB = b.quantityInStock ?? 0;
        return stockSortAsc ? stockA - stockB : stockB - stockA;
      });
    }

    return { items, total, page, totalPages: Math.ceil(total / limit) };
  }

  static async getBulkProducts(ids: string[]): Promise<any[]> {
    if (!ids.length) return [];
    const validIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id)).slice(0, 20).map(id => new mongoose.Types.ObjectId(id));
    if (!validIds.length) return [];
    const productsRaw = await Product.find({ _id: { $in: validIds } }).select('name brandId image variants categories discountPercentage discountStartDate discountEndDate soldCount createdAt').populate('brandId').populate('categories').lean()
    return formatMultipleProducts(productsRaw);
  }

  static async suggestProducts(query: string, limit: number = 8): Promise<any[]> {
    if (!query || !query.trim()) {
      const randomProducts = await Product.aggregate([{ $sample: { size: limit } }, { $lookup: { from: 'brands', localField: 'brandId', foreignField: '_id', as: 'brand' } }, { $unwind: { path: '$brand', preserveNullAndEmptyArrays: true } }, { $project: { name: 1, image: 1, brand: '$brand.name' } }]);
      const formatted = await formatMultipleProducts(randomProducts);
      return formatted.map((p: any) => ({ _id: p._id, name: p.name, price: p.price, image: p.image || '', brand: p.brand || '' }));
    }
    const cleanQuery = query.trim();
    const cacheKey = `products:suggest:v2:${cleanQuery.toLowerCase()}`;
    try { const cached = await redis.get(cacheKey); if (cached) return JSON.parse(cached); } catch (err) { console.warn('Redis error in suggestProducts:', err); }

    // Tìm brand bằng text index (nhanh hơn $regex)
    const matchingBrands = await Brand.find(
      { $text: { $search: cleanQuery } },
      { score: { $meta: 'textScore' } }
    ).sort({ score: { $meta: 'textScore' } })
    const brandIds = matchingBrands.map(b => b._id);

    // Tìm product bằng text index + brand match
    const escaped = cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const productsRaw = await Product.find(
      {
        $or: [
          { $text: { $search: cleanQuery } },
          { name: { $regex: `^${escaped}`, $options: 'i' } }, // prefix match cho autocomplete
          ...(brandIds.length > 0 ? [{ brandId: { $in: brandIds } }] : []),
        ],
      },
      brandIds.length > 0 ? { score: { $meta: 'textScore' } } : {}
    )
      .populate('brandId', 'name')
      
      .sort(brandIds.length > 0 ? { score: { $meta: 'textScore' } } : {})
      .limit(limit)
      .lean();

    const formatted = await formatMultipleProducts(productsRaw);
    const result = formatted.map((p: any) => ({ _id: p._id, name: p.name, price: p.price, originalPrice: p.originalPrice || p.price, discount: p.discount || 0, image: p.image || '', brand: p.brand || '' }));
    if (result.length > 0) { try { await redis.set(cacheKey, JSON.stringify(result), 'EX', 300); } catch (err) { console.warn('Redis set error in suggestProducts:', err); } }
    return result;
  }

  static async getProductById(id: string): Promise<any | null> {
    const product = await Product.findOne({ _id: id }).populate('brandId').populate('categories').lean();
    if (!product) return null;

    const images = await ProductImage.find({ productId: id }).lean();
    const variantIds = (product.variants || []) as mongoose.Types.ObjectId[];
    const variants = variantIds.length > 0 ? await ProductVariant.find({ _id: { $in: variantIds } }).sort({ sortOrder: 1 }).lean() : [];

    const tagLinks = await ProductTag.find({ productId: id }).populate({ path: 'tagId', model: 'Tag', select: 'name slug' }).lean();
    const tagSlugs = tagLinks.map(l => (l.tagId as any)?.slug).filter(Boolean);

    let oldCatName = '';
    if (!(product.categories as any[])?.length) {
      const oldCatId = (product as any).categoryId;
      if (oldCatId) { try { const catDoc = await Category.findById(oldCatId).lean(); if (catDoc) oldCatName = catDoc.name; } catch (_) {} }
    }

    const variant50ml = variants.find((v: any) => v.size === '50ml') || variants[0];
    let computedPrice = variant50ml?.price || 0;
    if (computedPrice > 0 && (product as any).discountPercentage > 0) {
      const now = new Date();
      const startOk = !(product as any).discountStartDate || new Date((product as any).discountStartDate) <= now;
      const endOk = !(product as any).discountEndDate || new Date((product as any).discountEndDate) >= now;
      if (startOk && endOk) computedPrice = Math.round(computedPrice * (1 - (product as any).discountPercentage / 100));
    }

    return {
      ...product,
      price: computedPrice,
      discount: (product as any).discountPercentage || 0,
      brand: (product.brandId as any)?.name || '',
      categories: resolveCategoryNames(product, undefined, oldCatName),
      image: images[0]?.url || '',
      images: images.slice(1).map(img => img.url),
      variants: variants.map(v => ({
        _id: v._id,
        size: v.size,
        price: v.price,
        quantityInStock: v.quantityInStock,
        sku: v.sku,
        isDefault: v.isDefault,
      })),
      size: variants.map(v => `${v.size}:${v.price}`).join(', '),
      tag: tagSlugs.join(', '),
      quantityInStock: variants.reduce((sum, v) => sum + (v.quantityInStock || 0), 0),
    };
  }
}
