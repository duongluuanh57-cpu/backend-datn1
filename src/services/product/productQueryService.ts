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
import { formatMultipleProducts } from './productFormatterService.ts';
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
    const cacheKey = `products:new:tag:v5`;
    try { const cached = await redis.get(cacheKey); if (cached) return JSON.parse(cached); } catch (err) {}
    const fsProductIds = await FlashSaleService.getActiveFlashSaleProductIds();
    const productIds = await this.getProductIdsByTagSlugs(['new', 'san-pham-moi']);
    const select = 'name brandId image variants categories discountPercentage discountStartDate discountEndDate soldCount createdAt status';
    const baseFilter: any = { status: 'active' };
    if (fsProductIds.length > 0) baseFilter._id = { $nin: fsProductIds };
    let productsRaw;
    if (productIds.length > 0) {
      const filteredProductIds = productIds.filter(id => !fsProductIds.some(fsId => fsId.equals(id)));
      productsRaw = await Product.find({ _id: { $in: filteredProductIds }, status: 'active' }).select(select).populate('brandId').populate('categories').sort({ createdAt: -1 }).limit(15).lean();
    } else {
      productsRaw = await Product.find(baseFilter).select(select).populate('brandId').populate('categories').sort({ createdAt: -1 }).limit(15).lean();
    }
    const products = await formatMultipleProducts(productsRaw);
    if (products.length > 0) { try { await redis.set(cacheKey, JSON.stringify(products), 'EX', this.CACHE_TTL); } catch (err) {} }
    return products;
  }

  static async getLimitedProducts(): Promise<any[]> {
    const cacheKey = `products:limited:tag:v4`;
    try { const cached = await redis.get(cacheKey); if (cached) return JSON.parse(cached); } catch (err) {}
    const fsProductIds = await FlashSaleService.getActiveFlashSaleProductIds();
    const productIds = await this.getProductIdsByTagSlugs(['limited', 'gioi-han', 'gioi-han-dac-biet']);
    let productsRaw;
    if (productIds.length > 0) {
      const filteredProductIds = productIds.filter(id => !fsProductIds.some(fsId => fsId.equals(id)));
      productsRaw = await Product.find({ _id: { $in: filteredProductIds }, status: 'active' }).populate('brandId').populate('categories').sort({ createdAt: -1 }).limit(15).lean();
    } else {
      productsRaw = await Product.find({ status: 'active', _id: { $nin: fsProductIds } }).populate('brandId').populate('categories').sort({ createdAt: -1 }).limit(15).lean();
    }
    const products = await formatMultipleProducts(productsRaw);
    if (products.length > 0) { try { await redis.set(cacheKey, JSON.stringify(products), 'EX', this.CACHE_TTL); } catch (err) {} }
    return products;
  }

  static async getTrendingProducts(): Promise<any[]> {
    const cacheKey = `products:trending:tag:v5`;
    try { const cached = await redis.get(cacheKey); if (cached) return JSON.parse(cached); } catch (err) {}
    const fsProductIds = await FlashSaleService.getActiveFlashSaleProductIds();
    const productIds = await this.getProductIdsByTagSlugs(['trending', 'thinh-hanh', 'ban-chay', 'hot']);
    let productsRaw;
    if (productIds.length > 0) {
      const filteredProductIds = productIds.filter(id => !fsProductIds.some(fsId => fsId.equals(id)));
      productsRaw = await Product.find({ _id: { $in: filteredProductIds }, status: 'active' }).populate('brandId').populate('categories').sort({ createdAt: -1 }).limit(15).lean();
    } else {
      productsRaw = await Product.find({ status: 'active', _id: { $nin: fsProductIds } }).populate('brandId').populate('categories').sort({ soldCount: -1, createdAt: -1 }).limit(15).lean();
    }
    const products = await formatMultipleProducts(productsRaw);
    if (products.length > 0) { try { await redis.set(cacheKey, JSON.stringify(products), 'EX', this.CACHE_TTL); } catch (err) {} }
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
    const productsRaw = await Product.find({ _id: { $in: productIds }, status: 'active' }).populate('brandId').populate('categories').sort({ createdAt: -1 }).lean();
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
    const cacheKey = `products:sale:tag:v2`;
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

  static async getAllProducts(options: any = {}): Promise<{ items: any[]; total: number; page: number; totalPages: number }> {
    const { page = 1, limit = 25, search, brand, stock, tag, category, sortBy, status, minPrice, maxPrice } = options;
    const query: any = {};
    if (search) { query.$text = { $search: search }; }
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
    if (tag && tag !== 'all') {
      const isSaleTag = ['sale', 'flash-sale', 'giam-gia'].includes(tag.toLowerCase());
      let productIds: mongoose.Types.ObjectId[] = [];

      if (isSaleTag) {
        // Chỉ lấy các sản phẩm được gán trực tiếp vào sự kiện Flash Sale đang diễn ra (Active)
        productIds = await FlashSaleService.getActiveFlashSaleProductIds();
      } else {
        const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const tagDoc = await Tag.findOne({ status: 'active', $or: [{ slug: { $regex: `^${escapedTag}$`, $options: 'i' } }, { name: { $regex: `^${escapedTag}$`, $options: 'i' } }] });
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
      const categoryIds = category.split(',').map((s: string) => s.trim()).filter(Boolean);
      const validCategoryIds = categoryIds.filter((id: string) => mongoose.Types.ObjectId.isValid(id));
      if (validCategoryIds.length > 0) {
        query.$and = query.$and || [];
        const catConditions = validCategoryIds.map((id: string) => ({ $or: [{ categories: new mongoose.Types.ObjectId(id) }, { categoryId: new mongoose.Types.ObjectId(id) }] }));
        query.$and.push({ $or: catConditions });
      } else {
        return { items: [], total: 0, page, totalPages: 0 };
      }
    }
    let sort: any = { createdAt: -1 };
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
      case 'bestSeller': sort = { soldCount: -1, createdAt: -1 }; break;
    }
    let total: number;
    let products: any[];
    let items: any[];

    if (minPrice || maxPrice) {
      // Price filter: get ALL matches, filter in-memory, then paginate
      const all = await Product.find(query)
        .select('name brandId image variants categories discountPercentage discountStartDate discountEndDate soldCount createdAt status')
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
      const pageIds = matched.slice((page - 1) * limit, page * limit).map((p: any) => String(p._id));
      if (pageIds.length) {
        const prods = await Product.find({ _id: { $in: pageIds } })
          .select('name brandId image variants categories discountPercentage discountStartDate discountEndDate soldCount createdAt status')
          .populate('brandId')
          .populate('categories')
          .lean();
        const map = new Map(prods.map(p => [String(p._id), p]));
        products = pageIds.map(id => map.get(id)).filter(Boolean);
        items = await formatMultipleProducts(products);
      } else {
        products = [];
        items = [];
      }
    } else {
      try {
        total = await Product.countDocuments(query);
        products = await Product.find(query).select('name brandId image variants categories discountPercentage discountStartDate discountEndDate soldCount createdAt status').populate('brandId').populate('categories').sort(sort).skip((page - 1) * limit).limit(limit).lean();
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
    const productsRaw = await Product.find({ _id: { $in: validIds }, status: 'active' }).select('name brandId image variants categories discountPercentage discountStartDate discountEndDate soldCount createdAt status').populate('brandId').populate('categories').lean()
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

    // Tìm brand bằng text index + contains regex
    const escaped = cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matchingBrands = await Brand.find(
      { $or: [
        { $text: { $search: cleanQuery } },
        { name: { $regex: escaped, $options: 'i' } },
      ]},
      { score: { $meta: 'textScore' } }
    ).sort({ score: { $meta: 'textScore' } }).limit(5).lean();
    const brandIds = matchingBrands.map(b => b._id);

    // Tìm product bằng text index + brand match + contains search
    const productsRaw = await Product.find(
      {
        status: 'active',
        $or: [
          { $text: { $search: cleanQuery } },
          { name: { $regex: escaped, $options: 'i' } }, // contains match cho autocomplete
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
    const result = {
      products: formatted.map((p: any) => ({ _id: p._id, name: p.name, price: p.price, originalPrice: p.originalPrice || p.price, discount: p.discount || 0, image: p.image || '', brand: p.brand || '' })),
      brands: matchingBrands.map((b: any) => ({ _id: b._id, name: b.name, logo: b.logo || '' }))
    };
    if (result.products.length > 0 || result.brands.length > 0) { try { await redis.set(cacheKey, JSON.stringify(result), 'EX', 300); } catch (err) { console.warn('Redis set error in suggestProducts:', err); } }
    return result;
  }

  static async getProductById(id: string): Promise<any | null> {
    const product = await Product.findOne({ _id: id, status: 'active' }).populate('brandId').populate('categories').lean();
    if (!product) return null;

    const images = await ProductImage.find({ productId: id }).lean();
    const variantIds = (product.variants || []) as mongoose.Types.ObjectId[];
    const variants = variantIds.length > 0 ? await ProductVariant.find({ _id: { $in: variantIds } }).sort({ sortOrder: 1 }).lean() : [];

    const tagLinks = await ProductTag.find({ productId: id }).populate({ path: 'tagId', model: 'Tag', select: 'name slug status' }).lean();
    const tagSlugs = tagLinks
      .filter(l => (l.tagId as any)?.status === 'active')
      .map(l => (l.tagId as any)?.slug)
      .filter(Boolean);

    let oldCatName = '';
    if (!(product.categories as any[])?.length) {
      const oldCatId = (product as any).categoryId;
      if (oldCatId) { try { const catDoc = await Category.findById(oldCatId).lean(); if (catDoc) oldCatName = catDoc.name; } catch (_) {} }
    }

    const variant50mlInStock = variants.find((v: any) => v.size === '50ml' && (v.quantityInStock === undefined || v.quantityInStock > 0));
    const defaultVariant = variant50mlInStock
      || variants.find((v: any) => v.quantityInStock === undefined || v.quantityInStock > 0)
      || variants.find((v: any) => v.size === '50ml')
      || variants[0];
    const rawVariantPrice = defaultVariant?.price || (product as any).price || (product as any).originalPrice || 0;
    let baseDiscount = (product as any).discountPercentage || 0;

    let extraDiscount = 0;
    let fsStockLimit = 0;
    let fsSoldCount = 0;
    let isFS = false;

    const activeFS = await FlashSale.findOne({
      status: { $in: ['active', 'scheduled'] },
      'items.productId': new mongoose.Types.ObjectId(id),
    }).lean();

    if (activeFS) {
      const fsItem = (activeFS.items || []).find((it: any) => it.productId?.toString() === id.toString());
      if (fsItem) {
        extraDiscount = fsItem.extraDiscountPercentage || 0;
        fsStockLimit = fsItem.stockLimit || 0;
        fsSoldCount = fsItem.soldCount || 0;
        isFS = true;
      }
    }

    const totalDiscount = Math.min(100, baseDiscount + extraDiscount);
    let computedPrice = rawVariantPrice;
    if (computedPrice > 0 && totalDiscount > 0) {
      computedPrice = Math.round(rawVariantPrice * (1 - totalDiscount / 100));
    }

    const catStr = resolveCategoryNames(product, undefined, oldCatName);
    const catArr = catStr ? catStr.split(',').map(s => s.trim()).filter(Boolean) : [];

    // ── Tính reviewsCount và avgRating từ Review collection ──
    const reviewStats = await Review.aggregate([
      { $match: { productId: new mongoose.Types.ObjectId(id), status: 'visible' } },
      { $group: { _id: null, count: { $sum: 1 }, avg: { $avg: '$rating' } } },
    ]);
    const reviewsCount = reviewStats.length > 0 ? reviewStats[0].count : 0;
    const avgRating = reviewStats.length > 0 ? Math.round(reviewStats[0].avg * 10) / 10 : 0;

    return {
      ...product,
      price: computedPrice,
      originalPrice: rawVariantPrice,
      discount: totalDiscount,
      discountPercentage: totalDiscount,
      stockLimit: fsStockLimit,
      soldCount: fsSoldCount,
      isFlashSale: isFS,
      brand: (product.brandId as any)?.name || '',
      categories: catArr,
      image: images[0]?.url || '',
      images: images.slice(1).map(img => img.url),
      variants: variants.map(v => ({
        _id: v._id,
        size: v.size,
        price: v.price,
        originalPrice: v.price,
        quantityInStock: v.quantityInStock,
        sku: v.sku,
        isDefault: v.isDefault,
      })),
      size: variants.map(v => `${v.size}:${v.price}`).join(', '),
      tag: tagSlugs.join(', '),
      quantityInStock: variants.reduce((sum, v) => sum + (v.quantityInStock || 0), 0),
      reviewsCount,
      avgRating,
      rating: avgRating,
    };
  }

  static async getProductByIdAdmin(id: string): Promise<any | null> {
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

    const catStr = resolveCategoryNames(product, undefined, oldCatName);
    const catArr = catStr ? catStr.split(',').map(s => s.trim()).filter(Boolean) : [];

    // ── Tính reviewsCount và avgRating từ Review collection ──
    const stats = await Review.aggregate([
      { $match: { productId: new mongoose.Types.ObjectId(id), status: 'visible' } },
      { $group: { _id: null, count: { $sum: 1 }, avg: { $avg: '$rating' } } },
    ]);
    const reviewsCount = stats[0]?.count || 0;
    const avgRating = stats[0]?.avg ? Math.round(stats[0].avg * 10) / 10 : 0;

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

    return {
      ...product,
      specifications: specs,
      longevity: specs.longevity || (product as any).longevity || '',
      sillage: specs.sillage || (product as any).sillage || '',
      durability: specs.durability || (product as any).durability || '',
      scentTrail: specs.scentTrail || (product as any).scentTrail || '',
      style: specs.style || (product as any).style || '',
      suitableFor: specs.suitableFor || (product as any).suitableFor || '',
      occasion: specs.occasion || (product as any).occasion || '',
      season: specs.season || (product as any).season || '',
      time: specs.time || (product as any).time || '',
      images: images.map(i => i.url),
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
