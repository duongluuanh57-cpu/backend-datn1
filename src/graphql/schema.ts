import { makeExecutableSchema } from '@graphql-tools/schema';
import { ProductService } from '../services/ProductService.ts';
import { BrandService } from '../services/BrandService.ts';
import { safeRedisGet, safeRedisSet } from '../config/redis.ts';

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
    categories: [String!]
    variants: [Variant!]
    size: String
    quantityInStock: Int
    longevity: String
    sillage: String
    durability: String
    scentTrail: String
    style: String
    suitableFor: String
    occasion: String
    season: String
    time: String
  }

  type HomepageData {
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

  type Query {
    homepage: HomepageData!
    productDetail(id: ID!): ProductDetail
    trendingProducts(limit: Int = 8): [Product!]
    products(type: String!, limit: Int = 10): [Product!]
    brands: [Brand!]
    navbar: NavbarData!
  }
`;

function mapProduct(p: any) {
  return {
    _id: p._id?.toString() || p.id || '',
    name: p.name || '',
    brand: p.brand || '',
    price: p.price ?? 0,
    originalPrice: p.originalPrice || p.original_price || null,
    image: p.image || '',
    tag: p.tag || '',
    discount: p.discount ?? p.discountPercentage ?? null,
    reviewsCount: p.reviewsCount ?? p.reviews_count ?? null,
    soldCount: p.soldCount ?? p.sold_count ?? null,
    quantityInStock: p.quantityInStock ?? 0,
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
    longevity: p.longevity || '',
    sillage: p.sillage || '',
    durability: p.durability || '',
    scentTrail: p.scentTrail || '',
    style: p.style || '',
    suitableFor: p.suitableFor || '',
    occasion: p.occasion || '',
    season: p.season || '',
    time: p.time || '',
  };
}

const resolvers = {
  Query: {
    homepage: async () => {
      const cacheKey = 'homepage:v3';
      const cached = await safeRedisGet(cacheKey);
      if (cached) {
        console.log('[Cache HIT] Homepage');
        return JSON.parse(cached);
      }
      console.log('[Cache MISS] Homepage');
      const [sale, newProducts, hot, limited, standardResult, brands] = await Promise.race([
        Promise.all([
          ProductService.getSaleProducts(),
          ProductService.getNewProducts(),
          ProductService.getTrendingProducts(),
          ProductService.getLimitedProducts(),
          ProductService.getAllProducts({ limit: 20, sortBy: 'newest' }),
          BrandService.getAllBrands(),
        ]),
        new Promise<any[]>((resolve) => setTimeout(() => resolve([[], [], [], [], { items: [] }, []]), 10_000)),
      ]);
      const standard = standardResult.items || [];
      const result = {
        sale: (sale || []).slice(0, 8).map(mapProduct),
        new: (newProducts || []).slice(0, 8).map(mapProduct),
        hot: (hot || []).slice(0, 10).map(mapProduct),
        limited: (limited || []).slice(0, 10).map(mapProduct),
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
          const result = await ProductService.getAllProducts({ limit: 20, sortBy: 'newest' });
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
  },
};

export const schema = makeExecutableSchema({ typeDefs, resolvers });