import mongoose from 'mongoose';
import { Product } from '../../models/Product.ts';
import { ProductImage } from '../../models/ProductImage.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { ProductTag } from '../../models/ProductTag.ts';
import { Tag } from '../../models/Tag.ts';
import { Category } from '../../models/Category.ts';
import { Review } from '../../models/Review.ts';
import { FlashSale } from '../../models/FlashSale.ts';
import { resolveCategoryNames } from './productHelpers.ts';

function parseCapacity(size: string | undefined): number {
  if (!size) return 0;
  return parseInt(String(size).replace(/\D/g, ''), 10) || 0;
}

export function getDefaultVariant(productVariants: any[]): any {
  if (!productVariants || productVariants.length === 0) return null;
  // Sắp xếp các biến thể theo dung tích lớn nhất trước (descending)
  const sorted = [...productVariants].sort((a: any, b: any) => {
    const capA = parseCapacity(a.size);
    const capB = parseCapacity(b.size);
    if (capA !== capB) return capB - capA;
    return (b.sortOrder ?? 0) - (a.sortOrder ?? 0);
  });
  // Ưu tiên biến thể có dung tích lớn nhất còn hàng
  const inStockVariant = sorted.find((v: any) => v.quantityInStock === undefined || v.quantityInStock > 0);
  return inStockVariant || sorted[0];
}

function getPriceFromVariants(product: any, productVariants: any[], discountPercentage?: number): number {
  const inStockVariant = getDefaultVariant(productVariants);
  let price = inStockVariant ? inStockVariant.price : (product.price || product.originalPrice || product.original_price || 0);
  if (discountPercentage && discountPercentage > 0) {
    price = price * (1 - discountPercentage / 100);
  }
  return Math.round(price);
}

let cachedFlashSales: any[] | null = null;
let flashSalesCacheExpiry = 0;

async function getCachedActiveFlashSales(): Promise<any[]> {
  const now = Date.now();
  if (cachedFlashSales && now < flashSalesCacheExpiry) {
    return cachedFlashSales;
  }
  const fsList = await FlashSale.find({ status: { $in: ['active', 'scheduled'] } }).select('name status items').lean() as any[];
  cachedFlashSales = fsList;
  flashSalesCacheExpiry = now + 15000; // 15s in-memory TTL
  return fsList;
}

export function invalidateFlashSaleFormatterCache(): void {
  cachedFlashSales = null;
  flashSalesCacheExpiry = 0;
}



export async function formatMultipleProducts(products: any[]): Promise<any[]> {
  if (products.length === 0) return [];

  const productIds = products.map(p => p._id.toString());
  const allVariantIds = products.flatMap(p =>
    (p.variants || []).map((v: any) => (v && (v._id ? v._id.toString() : v.toString()))).filter(Boolean)
  ).filter(id => id && id !== '[object Object]');

  const oldCatIds = products
    .filter(p => !(p.categories as any[])?.length && (p as any).categoryId)
    .map(p => (p as any).categoryId).filter(Boolean);

  // Chạy song song 6 truy vấn độc lập bằng Promise.all với populate trực tiếp tagId
  const [images, variants, tagLinks, catDocs, reviewAgg, activeFlashSales] = await Promise.all([
    ProductImage.find({ productId: { $in: productIds } }).select('url productId').lean() as Promise<any[]>,
    ProductVariant.find({
      $or: [
        ...(allVariantIds.length > 0 ? [{ _id: { $in: allVariantIds.map(id => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id) } }] : []),
        { productId: { $in: productIds.map(id => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id) } },
      ],
    }).select('productId size price sortOrder quantityInStock type isDefault').sort({ sortOrder: 1 }).lean() as Promise<any[]>,
    ProductTag.find({ productId: { $in: productIds } }).populate({ path: 'tagId', model: Tag, select: 'slug status' }).select('productId tagId').lean() as Promise<any[]>,
    oldCatIds.length > 0
      ? Category.find({ _id: { $in: oldCatIds } }).select('name').lean() as Promise<any[]>
      : Promise.resolve([]),
    Review.aggregate([
      { $match: { productId: { $in: productIds.map(id => new mongoose.Types.ObjectId(id)) }, status: 'visible' } },
      { $group: { _id: '$productId', count: { $sum: 1 }, avg: { $avg: '$rating' } } },
    ]),
    getCachedActiveFlashSales(),
  ]);

  const imageMap = new Map<string, string[]>();
  for (const img of images) {
    const pId = img.productId.toString();
    if (!imageMap.has(pId)) imageMap.set(pId, []);
    imageMap.get(pId)!.push(img.url);
  }

  const variantById = new Map<string, any>();
  const variantsByProductId = new Map<string, any[]>();
  for (const v of variants) {
    variantById.set(v._id.toString(), v);
    if (v.productId) {
      const pIdStr = v.productId.toString();
      if (!variantsByProductId.has(pIdStr)) variantsByProductId.set(pIdStr, []);
      variantsByProductId.get(pIdStr)!.push(v);
    }
  }

  const tagMap = new Map<string, string[]>();
  for (const link of tagLinks) {
    const pId = link.productId.toString();
    const tagDoc = link.tagId as any;
    if (tagDoc && tagDoc.status === 'active' && tagDoc.slug) {
      if (!tagMap.has(pId)) tagMap.set(pId, []);
      tagMap.get(pId)!.push(tagDoc.slug);
    }
  }

  const oldCatMap = new Map<string, string>();
  for (const cat of catDocs) oldCatMap.set(cat._id.toString(), cat.name);

  const reviewMap = new Map<string, { count: number; avg: number }>();
  for (const r of reviewAgg) reviewMap.set(r._id.toString(), { count: r.count, avg: Math.round(r.avg * 10) / 10 });

  const flashSaleMap = new Map<string, { id: string; name: string; status: string; extraDiscountPercentage: number }>();
  for (const fs of activeFlashSales) {
    for (const item of (fs.items || [])) {
      if (item.productId) {
        flashSaleMap.set(item.productId.toString(), {
          id: fs._id.toString(),
          name: fs.name,
          status: fs.status,
          extraDiscountPercentage: item.extraDiscountPercentage || 0,
        });
      }
    }
  }

  return products.map(product => {
    const pId = product._id.toString();
    const productImages = imageMap.get(pId) || [];
    let productVariants = (product.variants || [])
      .map((v: any) => {
        if (v && typeof v === 'object' && v.price !== undefined) return v;
        const vIdStr = v && (v._id ? v._id.toString() : v.toString());
        return variantById.get(vIdStr);
      }).filter(Boolean);
    if (productVariants.length === 0 && variantsByProductId.has(pId)) {
      productVariants = variantsByProductId.get(pId)!;
    }
    const reviewStats = reviewMap.get(pId);
    let reviewsCount = reviewStats?.count ?? (product as any).reviewsCount ?? 0;
    const avgRating = reviewStats?.avg ?? (product as any).avgRating ?? 0;
    // Bảo vệ logic thương mại: Số đánh giá không bao giờ được lớn hơn số lượt bán
    const pSoldCount = (product as any).soldCount || 0;
    if (reviewsCount > pSoldCount) {
      reviewsCount = pSoldCount > 0 ? Math.max(1, Math.min(pSoldCount, Math.round(pSoldCount * 0.5))) : 0;
    }

    const fsInfo = flashSaleMap.get(pId);
    const flashSaleDisplay = fsInfo ? `${fsInfo.name}${fsInfo.extraDiscountPercentage ? ' (-' + fsInfo.extraDiscountPercentage + '%)' : ''}` : '';
    const rawTagSlugs: string[] = tagMap.get(pId) || (product as any).tag?.split(',').map((s: string) => s.trim()) || [];
    const productTag = rawTagSlugs.join(', ') || (product as any).tag || '';

    const defaultVar = getDefaultVariant(productVariants);
    const extraDiscount = (fsInfo && fsInfo.status === 'active') ? (fsInfo.extraDiscountPercentage || 0) : 0;

    const quantityInStock = productVariants.length > 0
      ? productVariants.reduce((sum: number, v: any) => sum + (v.quantityInStock || 0), 0)
      : (product.quantityInStock ?? product.stock ?? 1);

    const baseDiscount = product.discountPercentage || product.discount || 0;
    const totalDiscount = Math.min(100, baseDiscount + extraDiscount);

    const availableVariants = productVariants.map((v: any) => {
      const num = parseInt(String(v.size || '').replace(/\D/g, ''), 10) || 0;
      const type = v.type || (num > 0 && num < 50 ? 'decant' : 'fullbox');
      return {
        _id: v._id?.toString(),
        size: v.size,
        type,
        price: v.price,
        quantityInStock: v.quantityInStock ?? 0,
        inStock: (v.quantityInStock ?? 0) > 0,
        isDefault: !!v.isDefault,
      };
    });

    return {
      ...product,
      brand: (product.brandId as any)?.name || '',
      image: productImages[0] || product.image || (Array.isArray(product.images) ? product.images[0] : '') || '',
      images: productImages.length > 0 ? productImages.slice(1) : (Array.isArray(product.images) ? product.images.slice(1) : []),
      size: productVariants.map((v: any) => `${v.size}:${v.price}`).join(', '),
      availableVariants,
      tag: productTag,
      isNewArrival: (product as any).isNewArrival ?? false,
      categories: resolveCategoryNames(product, {} as Record<string, any[]>, oldCatMap.get((product as any).categoryId?.toString())),
      price: getPriceFromVariants(product, productVariants, totalDiscount),
      originalPrice: defaultVar?.price || 0,
      defaultVariantSize: defaultVar?.size || '100ml',
      discount: totalDiscount,
      discountPercentage: totalDiscount,
      quantityInStock,
      reviewsCount,
      avgRating,
      rating: avgRating,
      flashSaleId: fsInfo?.id || '',
      flashSaleName: fsInfo?.name || '',
      flashSale: flashSaleDisplay,
      season: (product as any).season || (product as any).specifications?.season || '',
    };
  });
}

export async function getEffectiveProductDiscounts(
  productIds: (string | mongoose.Types.ObjectId)[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!productIds || productIds.length === 0) return result;

  const validIds = productIds
    .filter(Boolean)
    .map(id => (typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id));
  if (validIds.length === 0) return result;

  const [products, variants, tagLinks, activeFlashSales] = await Promise.all([
    Product.find({ _id: { $in: validIds } })
      .select('createdAt discountPercentage quantityInStock stock tag')
      .lean(),
    ProductVariant.find({ productId: { $in: validIds } })
      .select('productId quantityInStock')
      .lean(),
    ProductTag.find({ productId: { $in: validIds } })
      .populate({ path: 'tagId', model: Tag, select: 'slug status' })
      .select('productId tagId')
      .lean(),
    getCachedActiveFlashSales(),
  ]);

  const tagMap = new Map<string, string[]>();
  for (const link of tagLinks) {
    const pId = link.productId.toString();
    const tagDoc = link.tagId as any;
    if (tagDoc && tagDoc.status === 'active' && tagDoc.slug) {
      if (!tagMap.has(pId)) tagMap.set(pId, []);
      tagMap.get(pId)!.push(tagDoc.slug);
    }
  }

  const variantsByProductId = new Map<string, any[]>();
  for (const v of variants) {
    if (v.productId) {
      const pIdStr = v.productId.toString();
      if (!variantsByProductId.has(pIdStr)) variantsByProductId.set(pIdStr, []);
      variantsByProductId.get(pIdStr)!.push(v);
    }
  }

  const flashSaleMap = new Map<string, number>();
  for (const fs of activeFlashSales) {
    if (fs.status === 'active') {
      for (const item of fs.items || []) {
        if (item.productId) {
          const isFSExhausted = item.stockLimit > 0 && (item.soldCount || 0) >= item.stockLimit;
          if (!isFSExhausted && item.extraDiscountPercentage) {
            flashSaleMap.set(item.productId.toString(), item.extraDiscountPercentage);
          }
        }
      }
    }
  }

  for (const product of products) {
    const pId = product._id.toString();
    const extraDiscount = flashSaleMap.get(pId) || 0;
    const baseDiscount = product.discountPercentage || (product as any).discount || 0;
    const totalDiscount = Math.min(100, baseDiscount + extraDiscount);
    result.set(pId, totalDiscount);
  }

  return result;
}

export async function getEffectiveProductDiscount(
  productId: string | mongoose.Types.ObjectId
): Promise<number> {
  const map = await getEffectiveProductDiscounts([productId]);
  return map.get(productId.toString()) || 0;
}