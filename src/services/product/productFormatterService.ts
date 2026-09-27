import mongoose from 'mongoose';
import { Product } from '../../models/Product.ts';
import { ProductImage } from '../../models/ProductImage.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { ProductTag } from '../../models/ProductTag.ts';
import { Tag } from '../../models/Tag.ts';
import { Category } from '../../models/Category.ts';
import { Review } from '../../models/Review.ts';
import { FlashSale } from '../../models/FlashSale.ts';

function parseCapacity(size: string | undefined): number {
  if (!size) return 0;
  return parseInt(String(size).replace(/\D/g, ''), 10) || 0;
}

function sortByCapacityDesc(productVariants: any[]): any[] {
  // Dung tích lớn nhất trước (descending)
  return [...productVariants].sort((a: any, b: any) => parseCapacity(b.size) - parseCapacity(a.size));
}

/**
 * Biến thể mặc định để BÁN: dung tích lớn nhất còn hàng.
 * Hết hàng toàn bộ → null, không trả biến thể 0 tồn kho để người mua không chọn phải size mua được.
 */
export function getDefaultVariant(productVariants: any[]): any {
  if (!productVariants || productVariants.length === 0) return null;
  return sortByCapacityDesc(productVariants).find((v: any) => (v.quantityInStock ?? 0) > 0) || null;
}

/** Biến thể để HIỂN THỊ GIÁ: còn hàng trước, sold out thì lấy biến thể lớn nhất cho giá không phải là 0. */
export function getDisplayVariant(productVariants: any[]): any {
  if (!productVariants || productVariants.length === 0) return null;
  return getDefaultVariant(productVariants) || sortByCapacityDesc(productVariants)[0];
}

function getPriceFromVariants(productVariants: any[], discountPercentage?: number): number {
  let price = getDisplayVariant(productVariants)?.price ?? 0;
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

  const catIds = products
    .map(p => ((p as any).categoryId?._id || (p as any).categoryId))
    .filter((id: any) => id && mongoose.Types.ObjectId.isValid(String(id)))
    .map((id: any) => new mongoose.Types.ObjectId(String(id)));

  // Chạy song song 6 truy vấn độc lập bằng Promise.all với populate trực tiếp tagId
  const [images, variants, tagLinks, catDocs, reviewAgg, activeFlashSales] = await Promise.all([
    ProductImage.find({ productId: { $in: productIds } }).select('url productId').lean() as Promise<any[]>,
    ProductVariant.find({
      productId: { $in: productIds.map(id => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id) },
    }).select('productId size price quantityInStock isDefault').lean() as Promise<any[]>,
    ProductTag.find({ productId: { $in: productIds } }).populate({ path: 'tagId', model: Tag, select: 'slug status' }).select('productId tagId').lean() as Promise<any[]>,
    catIds.length > 0
      ? Category.find({ _id: { $in: catIds } }).select('name slug status').lean() as Promise<any[]>
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

  const variantsByProductId = new Map<string, any[]>();
  for (const v of variants) {
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

  const catById = new Map<string, any>();
  for (const cat of catDocs) catById.set(cat._id.toString(), cat);

  const reviewMap = new Map<string, { count: number; avg: number }>();
  for (const r of reviewAgg) reviewMap.set(r._id.toString(), { count: r.count, avg: Math.round(r.avg * 10) / 10 });

  const flashSaleMap = new Map<string, { id: string; name: string; status: string; extraDiscountPercentage: number }>();
  for (const fs of activeFlashSales) {
    for (const item of (fs.items || [])) {
      if (item.productId) {
        // Ngân sách flash-sale đã bán hết (soldCount >= stockLimit) thì không còn giảm giá thêm.
        const exhausted = item.stockLimit > 0 && (item.soldCount || 0) >= item.stockLimit;
        flashSaleMap.set(item.productId.toString(), {
          id: fs._id.toString(),
          name: fs.name,
          status: fs.status,
          extraDiscountPercentage: exhausted ? 0 : (item.extraDiscountPercentage || 0),
        });
      }
    }
  }

  return products.map(product => {
    const pId = product._id.toString();
    const productImages = imageMap.get(pId) || [];
    const productVariants = variantsByProductId.get(pId) || [];
    const reviewStats = reviewMap.get(pId);
    let reviewsCount = reviewStats?.count ?? 0;
    const avgRating = reviewStats?.avg ?? 0;
    // Bảo vệ logic thương mại: Số đánh giá không bao giờ được lớn hơn số lượt bán
    const pSoldCount = (product as any).soldCount || 0;
    if (reviewsCount > pSoldCount) {
      reviewsCount = pSoldCount > 0 ? Math.max(1, Math.min(pSoldCount, Math.round(pSoldCount * 0.5))) : 0;
    }

    const fsInfo = flashSaleMap.get(pId);
    const flashSaleDisplay = fsInfo ? `${fsInfo.name}${fsInfo.extraDiscountPercentage ? ' (-' + fsInfo.extraDiscountPercentage + '%)' : ''}` : '';
    // Tag chỉ còn một nguồn sự thật: bảng trung gian ProductTag. `product.tag` không phải
    // cột của Product nên đọc nó chỉ hồi sinh dữ liệu cũ đã bị xoá một nửa.
    const rawTagSlugs: string[] = tagMap.get(pId) || [];
    const productTag = rawTagSlugs.join(', ');

    const buyableVariant = getDefaultVariant(productVariants);
    const displayVar = getDisplayVariant(productVariants);
    const extraDiscount = (fsInfo && fsInfo.status === 'active') ? (fsInfo.extraDiscountPercentage || 0) : 0;

    // Tồn kho chỉ nằm trên ProductVariant — Product không có cột stock nào, không được bịa số 1.
    const quantityInStock = productVariants.reduce((sum: number, v: any) => sum + (v.quantityInStock || 0), 0);

    const baseDiscount = product.discountPercentage || 0;
    const totalDiscount = Math.min(100, baseDiscount + extraDiscount);

    const availableVariants = productVariants.map((v: any) => {
      const num = parseInt(String(v.size || '').replace(/\D/g, ''), 10) || 0;
      // type không còn là cột DB — luôn suy ra từ size (<50ml = decant).
      const type = num > 0 && num < 50 ? 'decant' : 'fullbox';
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

    const catIdRaw = (product as any).categoryId?._id || (product as any).categoryId;
    const catIdStr = catIdRaw ? String(catIdRaw) : '';
    const categoryDoc = catIdStr ? catById.get(catIdStr) : undefined;
    const category = categoryDoc
      ? { _id: categoryDoc._id, name: categoryDoc.name, slug: categoryDoc.slug, status: categoryDoc.status }
      : ((product as any).categoryId && typeof (product as any).categoryId === 'object'
        ? { _id: (product as any).categoryId._id, name: (product as any).categoryId.name, slug: (product as any).categoryId.slug, status: (product as any).categoryId.status }
        : null);

    return {
      ...product,
      brand: (product.brandId as any)?.name || '',
      image: productImages[0] || product.image || (Array.isArray(product.images) ? product.images[0] : '') || '',
      images: productImages.length > 0 ? productImages.slice(1) : (Array.isArray(product.images) ? product.images.slice(1) : []),
      size: productVariants.map((v: any) => `${v.size}:${v.price}`).join(', '),
      availableVariants,
      tag: productTag,
      isNewArrival: (product as any).isNewArrival ?? false,
      categoryId: catIdStr || null,
      category,
      price: getPriceFromVariants(productVariants, totalDiscount),
      originalPrice: displayVar?.price || 0,
      defaultVariantSize: buyableVariant?.size || '',
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

  const [products, activeFlashSales] = await Promise.all([
    Product.find({ _id: { $in: validIds } })
      .select('_id discountPercentage')
      .lean(),
    getCachedActiveFlashSales(),
  ]);

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
    const baseDiscount = product.discountPercentage || 0;
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