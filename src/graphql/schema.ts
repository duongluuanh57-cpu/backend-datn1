import { makeExecutableSchema } from '@graphql-tools/schema';
import { ProductService } from '../services/ProductService.ts';
import { BrandService } from '../services/BrandService.ts';
import { FlashSaleService } from '../services/FlashSaleService.ts';
import { safeRedisGet, safeRedisSet } from '../config/redis.ts';
import { verifyAccessToken } from '../utils/auth.ts';
import { Favorite } from '../models/Favorite.ts';
import Cart from '../models/Cart.ts';
import CartItem from '../models/CartItem.ts';
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
    sale: [Product!]
    new: [Product!]
    hot: [Product!]
    limited: [Product!]
    standard: [Product!]
    brands: [Brand!]
  }

  type NavbarData {
    trending: [Product!]
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
    categories: typeof p.categories === 'string'
      ? p.categories
      : Array.isArray(p.categories)
        ? p.categories.map((c: any) => (c && typeof c === 'object' && c.name ? c.name : String(c))).join(', ')
        : '',
    isFeatured: p.isFeatured ?? false,
    isNewArrival: p.isNewArrival ?? false,
    isBestSeller: p.isBestSeller ?? false,
    stockLimit: p.stockLimit ?? null,
    isFlashSale: p.isFlashSale ?? false,
    defaultVariantSize: p.defaultVariantSize || '50ml',
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
    categories: typeof p.categories === 'string'
      ? p.categories.split(',').map((s: string) => s.trim()).filter(Boolean)
      : Array.isArray(p.categories)
        ? p.categories
        : [],
    variants: (p.variants || []).map((v: any) => ({
      _id: v._id?.toString() || '',
      size: v.size || '',
      price: v.price ?? 0,
      quantityInStock: v.quantityInStock ?? 0,
      sku: v.sku || '',
      isDefault: v.isDefault ?? false,
    })),
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

const resolvers = {
  Query: {
    homepage: async () => {
      const cacheKey = 'homepage:v7';
      const cached = await safeRedisGet(cacheKey);
      if (cached) {
        console.log('[Cache HIT] Homepage');
        return JSON.parse(cached);
      }
      console.log('[Cache MISS] Homepage');
      const [activeFlashSaleEvents, sale, newProducts, hot, limited, standardResult, brands] = await Promise.race([
        Promise.all([
          FlashSaleService.getActiveFlashSales(3),
          ProductService.getSaleProducts(),
          ProductService.getNewProducts(),
          ProductService.getTrendingProducts(),
          ProductService.getLimitedProducts(),
          ProductService.getAllProducts({ limit: 20, sortBy: 'newest', status: 'active' }),
          BrandService.getAllBrands(),
        ]),
        new Promise<any[]>((resolve) => setTimeout(() => resolve([[], [], [], [], [], { items: [] }, []]), 10_000)),
      ]);
      const standard = standardResult.items || [];
      const formattedFlashSales = (activeFlashSaleEvents || []).map((ev: any) => ({
        _id: ev._id,
        name: ev.name,
        endDate: ev.endDate ? new Date(ev.endDate).toISOString() : null,
        products: (ev.items || []).slice(0, 20).map(mapProduct),
      }));

      const result = {
        flashSales: formattedFlashSales,
        sale: (sale || []).slice(0, 20).map(mapProduct),
        new: (newProducts || []).slice(0, 15).map(mapProduct),
        hot: (hot || []).slice(0, 15).map(mapProduct),
        limited: (limited || []).slice(0, 15).map(mapProduct),
        standard: (standard || []).slice(0, 10).map(mapProduct),
        brands: (brands || []).filter((b: any) => b.status === 'active' && b.logo).map(mapBrand),
      };
      await safeRedisSet(cacheKey, JSON.stringify(result), 'EX', 300);
      return result;
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
        const result = await ProductService.getAllProducts({
          page: args.page || 1,
          limit: args.limit || 20,
          search: args.search,
          brand: args.brand,
          stock: args.stock,
          tag: args.tag,
          category: args.category,
          sortBy: args.sortBy,
          status: args.status || 'active',
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
        const products = await ProductService.getTrendingProducts();
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
        case 'standard': {
          const result = await ProductService.getAllProducts({ limit: 20, sortBy: 'newest', status: 'active' });
          products = result.items || [];
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
      const [trending, brands] = await Promise.all([
        ProductService.getTrendingProducts(),
        BrandService.getAllBrands(),
      ]);
      return {
        trending: (trending || []).slice(0, 8).map(mapProduct),
        brandNames: (brands || []).map((b: any) => b.name).filter(Boolean),
      };
    },

    cartAndFavorites: async (_: any, __: any, context: { authorization?: string }) => {
      // Verify JWT từ context — nếu không có token thì trả về empty (không throw)
      const authHeader = context?.authorization;
      if (!authHeader?.startsWith('Bearer ')) return EMPTY_CART_AND_FAVORITES;

      let userId: string;
      try {
        const decoded = verifyAccessToken(authHeader.substring(7));
        userId = decoded.userId;
      } catch {
        return EMPTY_CART_AND_FAVORITES;
      }

      const userObjectId = new mongoose.Types.ObjectId(userId);

      // Fetch cart + favoriteIds song song
      const [cart, favorites] = await Promise.all([
        Cart.findOne({ userId: userObjectId }).lean(),
        Favorite.find({ userId: userObjectId }).select('productId').lean(),
      ]);

      let cartItems: any[] = [];
      if (cart) {
        const items = await CartItem.find({ cartId: cart._id }).lean();
        cartItems = items.map((item: any) => ({
          productId: item.productId?.toString() || '',
          name: item.name || '',
          image: item.image || null,
          brand: item.brand || null,
          price: item.price ?? 0,
          discount: item.discount ?? null,
          quantity: item.quantity ?? 1,
          variantSize: item.variantSize || null,
        }));
      }

      const totalItems = cartItems.reduce((sum, item) => sum + (item.quantity || 0), 0);
      const totalAmount = (cart as any)?.totalAmount ?? 0;
      const favoriteIds = favorites.map((f: any) => f.productId?.toString() || '');

      return {
        cart: { items: cartItems, totalAmount, totalItems },
        favoriteIds,
      };
    },
  },
};

export const schema = makeExecutableSchema({ typeDefs, resolvers });