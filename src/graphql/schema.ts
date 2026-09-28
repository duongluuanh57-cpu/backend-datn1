import { makeExecutableSchema } from '@graphql-tools/schema';
import { ProductService } from '../services/ProductService.ts';
import { DiscountLifecycleService } from '../services/product/discountLifecycleService.ts';
import { BrandService } from '../services/BrandService.ts';
import { FlashSaleService } from '../services/FlashSaleService.ts';
import { safeRedisGet, safeRedisSet } from '../config/redis.ts';
import { verifyAccessToken, ACCESS_COOKIE } from '../utils/auth.ts';
import { Favorite } from '../models/Favorite.ts';
import { CartService } from '../services/cart/CartService.ts';
import mongoose from 'mongoose';

const typeDefs = `#graphql
  type Product {
    _id: ID!
    name: String!
    brand: String!
    price: Float!
    originalPrice: Float
    image: String!
    tag: String
    discount: Float
    reviewsCount: Int
    soldCount: Int
    quantityInStock: Int
    rating: Float
    categories: String
    isFeatured: Boolean
    isNewArrival: Boolean
    isBestSeller: Boolean
    defaultVariantSize: String
    isFlashSale: Boolean
    stockLimit: Int
    season: String
  }

  type Brand {
    _id: ID!
    name: String!
    logo: String
    status: String
  }

  type Variant {
    _id: ID!
    size: String
    price: Float
    quantityInStock: Int
    sku: String
    isDefault: Boolean
    type: String
  }

  type BrandInfo {
    name: String
    logo: String
    description: String
    origin: String
  }

  type ProductDetail {
    _id: ID!
    name: String!
    brand: String!
    brandInfo: BrandInfo
    price: Float!
    originalPrice: Float
    image: String!
    images: [String!]
    description: String
    tag: String
    discount: Float
    reviewsCount: Int
    soldCount: Int
    rating: Float
    categories: [String!]
    variants: [Variant!]
    size: String
    quantityInStock: Int
    longevity: String
    sillage: String
    scentTrail: String
    style: String
    suitableFor: String
    occasion: String
    season: String
    time: String
  }

  type FlashSaleEventGql {
    _id: ID!
    name: String!
    endDate: String
    products: [Product!]
  }

  type HomepageData {
    flashSales: [FlashSaleEventGql!]
    new: [Product!]
    hot: [Product!]
    limited: [Product!]
    seasonal: [Product!]
    brands: [Brand!]
  }

  type NavbarData {
    suggestions: [Product!]
    brandNames: [String!]
  }

  type CartItemGql {
    productId: ID!
    name: String!
    image: String
    brand: String
    price: Float!
    discount: Float
    quantity: Int!
    variantSize: String
  }

  type CartDataGql {
    items: [CartItemGql!]!
    totalAmount: Float!
    totalItems: Int!
  }

  type CartAndFavorites {
    cart: CartDataGql!
    favoriteIds: [ID!]!
  }

  type ProductConnection {
    items: [Product!]!
    total: Int!
    page: Int!
    totalPages: Int!
  }

  type Query {
    homepage: HomepageData!
    productDetail(id: ID!): ProductDetail
    trendingProducts(limit: Int = 8): [Product!]
    products(type: String!, limit: Int = 10): [Product!]
    productsAll(
      page: Int
      limit: Int
      search: String
      brand: String
      stock: String
      tag: String
      category: String
      sortBy: String
      status: String
    ): ProductConnection!
    brands: [Brand!]
    navbar: NavbarData!
    cartAndFavorites: CartAndFavorites!
  }
`;

function parseCapacity(size: string | undefined): number {
  if (!size) return 0;
  return parseInt(String(size).replace(/\D/g, ''), 10) || 0;
}

function resolveLargestVariantSize(p: any): string {
  const variants = p.availableVariants || p.variants;
  if (Array.isArray(variants) && variants.length > 0) {
    const sorted = [...variants].sort((a: any, b: any) => parseCapacity(b.size) - parseCapacity(a.size));
    const inStock = sorted.find((v: any) => (v.quantityInStock ?? 0) > 0);
    // Size không có thật thì trả rỗng — bịa '100ml' khiến chat/checkout gửi size không tồn tại.
    return (inStock || sorted[0])?.size || '';
  }
  if (typeof p.size === 'string' && p.size) {
    const tokens = p.size.split(',').map((s: string) => s.split(':')[0].trim()).filter(Boolean);
    if (tokens.length > 0) {
      tokens.sort((a: string, b: string) => parseCapacity(b) - parseCapacity(a));
      return tokens[0];
    }
  }
  return p.defaultVariantSize || '';
}

function mapProduct(p: any) {
  return {
    _id: p._id?.toString() || p.id || '',
    name: p.name || '',
    brand: p.brand || '',
    price: p.price ?? 0,
    originalPrice: p.originalPrice || p.original_price || null,
    image: p.image || (Array.isArray(p.images) ? p.images[0] : '') || '',
    tag: p.tag || '',
    discount: p.discount ?? p.discountPercentage ?? null,
    reviewsCount: p.reviewsCount ?? p.reviews_count ?? null,
    soldCount: p.soldCount ?? p.sold_count ?? null,
    quantityInStock: p.quantityInStock ?? 0,
    rating: p.rating ?? p.avgRating ?? p.averageRating ?? null,
    categories: p.category?.name || (typeof p.categories === 'string' ? p.categories : ''),
    isFeatured: p.isFeatured ?? false,
    isNewArrival: p.isNewArrival ?? false,
    isBestSeller: p.isBestSeller ?? false,
    stockLimit: p.stockLimit ?? null,
    isFlashSale: p.isFlashSale ?? false,
    defaultVariantSize: resolveLargestVariantSize(p),
    season: p.season || p.specifications?.season || '',
  };
}

function mapBrand(b: any) {
  return {
    _id: b._id?.toString() || '',
    name: b.name || '',
    logo: b.logo || null,
    status: b.status || 'active',
  };
}

function mapProductDetail(p: any) {
  const brandDoc = p.brandId as any;
  return {
    _id: p._id?.toString() || '',
    name: p.name || '',
    brand: p.brand || (brandDoc?.name || ''),
    brandInfo: brandDoc ? {
      name: brandDoc.name || '',
      logo: brandDoc.logo || null,
      description: brandDoc.description || '',
      origin: brandDoc.origin || '',
    } : null,
    price: p.price ?? 0,
    originalPrice: p.originalPrice || p.original_price || null,
    image: p.image || '',
    images: p.images || [],
    description: p.description || '',
    tag: p.tag || '',
    discount: p.discount ?? p.discountPercentage ?? null,
    reviewsCount: p.reviewsCount ?? p.reviews_count ?? 0,
    soldCount: p.soldCount ?? p.sold_count ?? 0,
    rating: p.rating ?? p.avgRating ?? p.averageRating ?? null,
    categories: p.category?.name ? [p.category.name] : [],
    variants: (p.variants || []).map((v: any) => {
      const num = parseInt(String(v.size || '').replace(/\D/g, ''), 10) || 0;
      const vType = num > 0 && num < 50 ? 'decant' : 'fullbox';
      return {
        _id: v._id?.toString() || '',
        size: v.size || '',
        price: v.price ?? 0,
        quantityInStock: v.quantityInStock ?? 0,
        sku: v.sku || '',
        isDefault: v.isDefault ?? false,
        type: vType,
      };
    }),
    size: p.size || '',
    quantityInStock: p.quantityInStock ?? 0,
    longevity: p.specifications?.longevity || p.longevity || '',
    sillage: p.specifications?.sillage || p.sillage || '',
    scentTrail: p.specifications?.scentTrail || p.scentTrail || '',
    style: p.specifications?.style || p.style || '',
    suitableFor: p.specifications?.suitableFor || p.suitableFor || '',
    occasion: p.specifications?.occasion || p.occasion || '',
    season: p.specifications?.season || p.season || '',
    time: p.specifications?.time || p.time || '',
  };
}

const EMPTY_CART_AND_FAVORITES = {
  cart: { items: [], totalAmount: 0, totalItems: 0 },
  favoriteIds: [],
};

interface HomepageCacheEntry {
  data: any;
  cachedAt: number;
  /**
   * Thời gian coi là "mới" của entry. Bản rỗng (build thất bại) dùng 30s thay vì 3 phút
   * để request sau build lại ngay — không treo trang chủ suốt 10 phút.
   */
  freshMs?: number;
}

const HOMEPAGE_STALE_MS = 180_000; // 3 phút: sau 3 phút thì dữ liệu coi là stale, revalidate ngầm
const HOMEPAGE_EXPIRE_MS = 600_000; // 10 phút: tối đa lưu trong memory
const HOMEPAGE_EMPTY_TTL_MS = 30_000; // Bản rỗng chỉ giữ 30s: không hammer DB, nhưng cũng không giữ rỗng lâu
const HOMEPAGE_CACHE_KEY = 'homepage:v19';

let memHomepageCache: HomepageCacheEntry | null = null;
let singleFlightHomepagePromise: Promise<any> | null = null;

export function invalidateHomepageCache(): void {
  memHomepageCache = null;
}

/**
 * Trang chủ "trống trơn" = build THẤT BẠI, không phải cửa hàng tự trống: từng service đều
 * nuốt lỗi bằng `.catch(() => [])`, nên lúc backend cold start (DB/Redis chưa sẵn) hoặc
 * vượt quá timeout 20s là ra đúng một object rỗng cho cả 6 section.
 */
export function isEmptyHomepage(data: any): boolean {
  if (!data || typeof data !== 'object') return true;
  return ['flashSales', 'new', 'hot', 'limited', 'seasonal', 'brands'].every(
    (key) => !Array.isArray(data[key]) || data[key].length === 0,
  );
}

/** Bản tốt gần nhất (memory, không thì Redis) — dùng làm fallback khi build ra rỗng. */
async function readLastGoodHomepage(): Promise<any | null> {
  if (memHomepageCache && !isEmptyHomepage(memHomepageCache.data)) return memHomepageCache.data;
  try {
    const raw = await safeRedisGet(HOMEPAGE_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!isEmptyHomepage(parsed)) return parsed;
    }
  } catch {
    /* Redis cũng chết thì coi như không có bản cũ */
  }
  return null;
}

async function buildHomepageData(): Promise<any> {
  console.log('[Homepage Worker] Bắt đầu tổng hợp dữ liệu trang chủ...');
  let timedOut = false;
  const [activeFlashSaleEvents, newProducts, hot, limited, seasonalRaw, brands] = await Promise.race([
    Promise.all([
      FlashSaleService.getActiveFlashSales(3).catch(() => []),
      ProductService.getNewProducts().catch(() => []),
      ProductService.getTrendingProducts(16).catch(() => []),
      ProductService.getLimitedProducts().catch(() => []),
      ProductService.getSeasonalProducts(200).catch(() => []),
      BrandService.getAllBrands().catch(() => []),
    ]),
    new Promise<any[]>((resolve) => setTimeout(() => {
      timedOut = true;
      resolve([[], [], [], [], [], []]);
    }, 20_000)),
  ]);

  const formattedFlashSales = (activeFlashSaleEvents || []).map((ev: any) => ({
    _id: ev._id,
    name: ev.name,
    endDate: ev.endDate ? new Date(ev.endDate).toISOString() : null,
    products: (ev.items || []).slice(0, 20).map(mapProduct),
  }));

  const result = {
    flashSales: formattedFlashSales,
    new: (newProducts || []).map(mapProduct),
    hot: (hot || []).slice(0, 16).map(mapProduct),
    limited: (limited || []).slice(0, 16).map(mapProduct),
    // Một mảng duy nhất cho section "Bộ Sưu Tập Theo Mùa": trước đây `standard`
    // được phát lại đúng 200 sản phẩm này nên payload GraphQL tốn gấp đôi.
    seasonal: (seasonalRaw || []).slice(0, 200).map(mapProduct),
    brands: (brands || []).filter((b: any) => b.status === 'active' && b.logo).map(mapBrand),
  };

  // Chỉ cache khi tổng hợp xong THẬT. Timeout 20s hay mọi service trả rỗng (DB/Redis chưa
  // sẵn) đều là thất bại: ghi bản rỗng vào cache 10 phút thì trang chủ sẽ trống đúng ngay lúc
  // admin vừa tạo xong Flash Sale, và người dùng kết luận "tạo mà không hiện".
  if (!timedOut && !isEmptyHomepage(result)) {
    memHomepageCache = { data: result, cachedAt: Date.now() };
    await safeRedisSet(HOMEPAGE_CACHE_KEY, JSON.stringify(result), 'EX', 600);
    console.log('[Homepage Worker] Đã cập nhật cache trang chủ thành công');
    return result;
  }

  console.warn('[Homepage Worker] Build thất bại (timeout hoặc dữ liệu rỗng) — dùng bản cũ nếu có');
  const lastGood = await readLastGoodHomepage();
  if (lastGood) {
    // Vừa bị invalidate (mem trống) mà còn bản trong Redis → nạp vào memory ở trạng thái
    // "stale": request tới trả ngay bản cũ, đồng thời revalidate nền để tự hồi phục.
    if (!memHomepageCache || isEmptyHomepage(memHomepageCache.data)) {
      memHomepageCache = { data: lastGood, cachedAt: Date.now() - HOMEPAGE_STALE_MS };
    }
    return lastGood;
  }

  // Không có bản nào (server mọc giữa lúc DB chết) → giữ bản rỗng tối đa 30s rồi build lại,
  // thay vì treo trang chủ rỗng suốt 10 phút.
  memHomepageCache = { data: result, cachedAt: Date.now(), freshMs: HOMEPAGE_EMPTY_TTL_MS };
  return result;
}

function triggerBackgroundRevalidation() {
  if (singleFlightHomepagePromise) return; // Đang có worker chạy ngầm, không tạo worker mới
  singleFlightHomepagePromise = buildHomepageData().finally(() => {
    singleFlightHomepagePromise = null;
  });
}

const resolvers = {
  Query: {
    homepage: async () => {
      // Render không cần cron nền: đồng bộ trạng thái/giảm giá khi trang chủ nhận request.
      // Cả hai service đều tự throttle nên request tiếp theo không ghi DB liên tục.
      FlashSaleService.syncStatusesOnRead().catch((err) => {
        console.warn('[Homepage] FlashSale status sync error:', err);
      });
      DiscountLifecycleService.syncAutoDiscounts().catch((err) => {
        console.warn('[Homepage] discount sync error:', err);
      });

      const now = Date.now();

      // 1. In-Memory Cache: Nếu còn mới (< 3 phút; bản rỗng thì 30s) -> Phản hồi lập tức (< 1ms)
      const freshMs = memHomepageCache?.freshMs ?? HOMEPAGE_STALE_MS;
      if (memHomepageCache && now - memHomepageCache.cachedAt < freshMs) {
        return memHomepageCache.data;
      }

      // 2. In-Memory Cache: Nếu nằm trong khoảng stale (3 - 10 phút) -> Phản hồi lập tức & revalidate ngầm (SWR)
      if (memHomepageCache && (now - memHomepageCache.cachedAt < HOMEPAGE_EXPIRE_MS)) {
        triggerBackgroundRevalidation();
        return memHomepageCache.data;
      }

      // 3. Redis Cache Check (nếu memory bị cold do restart server)
      const cachedRedis = await safeRedisGet(HOMEPAGE_CACHE_KEY);
      if (cachedRedis) {
        try {
          const parsed = JSON.parse(cachedRedis);
          memHomepageCache = { data: parsed, cachedAt: now };
          return parsed;
        } catch {
          /* parse error, fallback to rebuild */
        }
      }

      // 4. Cold Start Cache Miss: Dùng Single-Flight Lock để chỉ duy nhất 1 request đi vào DB
      if (singleFlightHomepagePromise) {
        return await singleFlightHomepagePromise;
      }

      singleFlightHomepagePromise = buildHomepageData().finally(() => {
        singleFlightHomepagePromise = null;
      });

      return await singleFlightHomepagePromise;
    },

    productDetail: async (_: any, args: { id: string }) => {
      try {
        const product = await ProductService.getProductById(args.id);
        if (!product) return null;
        return mapProductDetail(product);
      } catch (err) {
        console.error('[GraphQL] productDetail error:', err);
        return null;
      }
    },

    productsAll: async (_: any, args: {
      page?: number;
      limit?: number;
      search?: string;
      brand?: string;
      stock?: string;
      tag?: string;
      category?: string;
      sortBy?: string;
      status?: string;
    }) => {
      try {
        // productsAll là query công khai: chỉ bao giờ trả hàng 'active',
        // không nhận status từ client (tránh lộ draft/archived như REST GET /api/products trước đây)
        const result = await ProductService.getAllProducts({
          page: args.page || 1,
          limit: args.limit || 20,
          search: args.search,
          brand: args.brand,
          stock: args.stock,
          tag: args.tag,
          category: args.category,
          sortBy: args.sortBy,
          status: 'active',
        });
        return {
          items: (result.items || []).map(mapProduct),
          total: result.total ?? 0,
          page: result.page ?? 1,
          totalPages: result.totalPages ?? 1,
        };
      } catch (err) {
        console.error('[GraphQL] productsAll error:', err);
        return { items: [], total: 0, page: 1, totalPages: 1 };
      }
    },

    trendingProducts: async (_: any, args: { limit: number }) => {
      const limit = args.limit || 8;
      try {
        const products = await ProductService.getTrendingProducts(limit);
        return (products || []).slice(0, limit).map(mapProduct);
      } catch (err) {
        console.error('[GraphQL] trendingProducts error:', err);
        return [];
      }
    },

    products: async (_: any, args: { type: string; limit: number }) => {
      const limit = args.limit || 10;
      let products: any[] = [];
      switch (args.type) {
        case 'sale': products = await ProductService.getSaleProducts(); break;
        case 'new': products = await ProductService.getNewProducts(); break;
        case 'hot': products = await ProductService.getTrendingProducts(); break;
        case 'limited': products = await ProductService.getLimitedProducts(); break;
        case 'standard':
        case 'seasonal': {
          products = await ProductService.getSeasonalProducts(limit || 100);
          break;
        }
        default: products = [];
      }
      return (products || []).slice(0, limit).map(mapProduct);
    },

    brands: async () => {
      const brands = await BrandService.getAllBrands();
      return (brands || []).filter((b: any) => b.status === 'active' && b.logo).map(mapBrand);
    },

    navbar: async () => {
      const [suggested, brands] = await Promise.all([
        // Danh sách gợi ý lúc bỏ trống ô tìm kiếm. Không lấy getTrendingProducts: luật Bán chạy
        // đòi soldCount >= 15 + rating >= 4.5, catalog hiện tại chưa có chai nào đạt (max soldCount = 1),
        // nên ô tìm kiếm sẽ trống trơn. 'Mới về' là dữ liệu thật và luôn có.
        ProductService.getNewProducts(8),
        BrandService.getAllBrands(),
      ]);
      return {
        suggestions: (suggested || []).slice(0, 8).map(mapProduct),
        brandNames: (brands || []).map((b: any) => b.name).filter(Boolean),
      };
    },

    cartAndFavorites: async (_: any, __: any, context: { authorization?: string; cookie?: any }) => {
      // Token từ httpOnly cookie (ưu tiên) hoặc Bearer header — không có thì trả empty (không throw)
      let token: string | undefined;
      if (context?.cookie?.[ACCESS_COOKIE]) {
        token = context.cookie[ACCESS_COOKIE];
      } else if (context?.authorization?.startsWith('Bearer ')) {
        token = context.authorization.substring(7);
      }
      if (!token) return EMPTY_CART_AND_FAVORITES;

      let userId: string;
      try {
        const decoded = verifyAccessToken(token);
        userId = decoded.userId;
      } catch {
        return EMPTY_CART_AND_FAVORITES;
      }

      const userObjectId = new mongoose.Types.ObjectId(userId);

      // Fetch cart_items + favoriteIds song song
      const [items, favorites] = await Promise.all([
        CartService.loadCartItems(userId),
        Favorite.find({ userId: userObjectId }).select('productId').lean(),
      ]);

      const cartItems = items.map((item: any) => ({
        productId: item.productId || '',
        name: item.name || '',
        image: item.image || null,
        brand: item.brand || null,
        price: item.price ?? 0,
        discount: item.discount ?? null,
        quantity: item.quantity ?? 1,
        variantSize: item.variantSize || null,
      }));

      const totalItems = cartItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
      const totalAmount = items.reduce((sum: number, item: any) => sum + item.price * (item.quantity || 1), 0);
      const favoriteIds = favorites.map((f: any) => f.productId?.toString() || '');

      return {
        cart: { items: cartItems, totalAmount, totalItems },
        favoriteIds,
      };
    },
  },
};

export const schema = makeExecutableSchema({ typeDefs, resolvers });