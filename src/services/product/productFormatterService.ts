import mongoose from 'mongoose';
import { ProductImage } from '../../models/ProductImage.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { ProductTag } from '../../models/ProductTag.ts';
import { Tag } from '../../models/Tag.ts';
import { Category } from '../../models/Category.ts';
import { Review } from '../../models/Review.ts';
import { FlashSale } from '../../models/FlashSale.ts';
import { resolveCategoryNames } from './productHelpers.ts';

function getDefaultVariant(productVariants: any[]): any {
  const variant50mlInStock = productVariants.find((v: any) => v.size === '50ml' && (v.quantityInStock === undefined || v.quantityInStock > 0));
  return variant50mlInStock
    || productVariants.find((v: any) => v.quantityInStock === undefined || v.quantityInStock > 0)
    || productVariants.find((v: any) => v.size === '50ml')
    || productVariants[0];
}

function getPriceFromVariants(product: any, productVariants: any[], discountPercentage?: number): number {
  const inStockVariant = getDefaultVariant(productVariants);
  let price = inStockVariant ? inStockVariant.price : (product.price || product.originalPrice || product.original_price || 0);
  if (discountPercentage && discountPercentage > 0) {
    price = price * (1 - discountPercentage / 100);
  }
  return Math.round(price);
}

export async function formatMultipleProducts(products: any[]): Promise<any[]> {
  if (products.length === 0) return [];

  const productIds = products.map(p => p._id.toString());

  // Chỉ select url + productId — giảm memory ~70% so với load full document
  const images = await ProductImage.find({ productId: { $in: productIds } })
    .select('url productId').lean() as any[];
  const imageMap = new Map<string, string[]>();
  for (const img of images) {
    const pId = img.productId.toString();
    if (!imageMap.has(pId)) imageMap.set(pId, []);
    imageMap.get(pId)!.push(img.url);
  }

  const allVariantIds = products.flatMap(p =>
    (p.variants || []).map((v: any) => (v && (v._id ? v._id.toString() : v.toString()))).filter(Boolean)
  ).filter(id => id && id !== '[object Object]');

  const variants = allVariantIds.length > 0
    ? await ProductVariant.find({ _id: { $in: allVariantIds.map(id => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id) } })
        .select('size price sortOrder quantityInStock').sort({ sortOrder: 1 }).lean() as any[]
    : [];
  const variantById = new Map<string, any>();
  for (const v of variants) variantById.set(v._id.toString(), v);

  // Lấy tag slugs trực tiếp qua ProductTag + Tag lookup (tránh populate overhead)
  const tagLinks = await ProductTag.find({ productId: { $in: productIds } })
    .select('productId tagId').lean() as any[];
  const allTagIds = [...new Set(tagLinks.map((l: any) => l.tagId?.toString()).filter(Boolean))];
  const tagDocs = allTagIds.length > 0
    ? await Tag.find({ _id: { $in: allTagIds }, status: 'active' }).select('slug').lean() as any[]
    : [];
  const tagSlugById = new Map<string, string>();
  for (const t of tagDocs) tagSlugById.set(t._id.toString(), t.slug);
  const tagMap = new Map<string, string[]>();
  for (const link of tagLinks) {
    const pId = link.productId.toString();
    if (!tagMap.has(pId)) tagMap.set(pId, []);
    const slug = tagSlugById.get(link.tagId?.toString());
    if (slug) tagMap.get(pId)!.push(slug);
  }

  const oldCatMap = new Map<string, string>();
  const oldCatIds = products
    .filter(p => !(p.categories as any[])?.length && (p as any).categoryId)
    .map(p => (p as any).categoryId).filter(Boolean);
  if (oldCatIds.length > 0) {
    const catDocs = await Category.find({ _id: { $in: oldCatIds } }).select('name').lean() as any[];
    for (const cat of catDocs) oldCatMap.set(cat._id.toString(), cat.name);
  }

  // Reviews: 1 aggregate query — thống nhất với chi tiết sản phẩm (status visible)
  const reviewAgg = await Review.aggregate([
    { $match: { productId: { $in: productIds.map(id => new mongoose.Types.ObjectId(id)) }, status: 'visible' } },
    { $group: { _id: '$productId', count: { $sum: 1 }, avg: { $avg: '$rating' } } },
  ]);
  const reviewMap = new Map<string, { count: number; avg: number }>();
  for (const r of reviewAgg) reviewMap.set(r._id.toString(), { count: r.count, avg: Math.round(r.avg * 10) / 10 });

  // Flash Sale Lookup
  const activeFlashSales = await FlashSale.find({ status: { $in: ['active', 'scheduled'] } }).select('name status items').lean() as any[];
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
    const productVariants = (product.variants || [])
      .map((v: any) => {
        if (v && typeof v === 'object' && v.price !== undefined) return v;
        const vIdStr = v && (v._id ? v._id.toString() : v.toString());
        return variantById.get(vIdStr);
      }).filter(Boolean);
    const reviewStats = reviewMap.get(pId);
    const reviewsCount = reviewStats?.count ?? 0;
    const avgRating = reviewStats?.avg ?? 0;

    const fsInfo = flashSaleMap.get(pId);
    const flashSaleDisplay = fsInfo ? `${fsInfo.name}${fsInfo.extraDiscountPercentage ? ' (-' + fsInfo.extraDiscountPercentage + '%)' : ''}` : '';
    let productTag = (tagMap.get(pId) || []).join(', ') || (product as any).tag || '';

    const defaultVar = getDefaultVariant(productVariants);

    return {
      ...product,
      brand: (product.brandId as any)?.name || '',
      image: productImages[0] || product.image || (Array.isArray(product.images) ? product.images[0] : '') || '',
      images: productImages.length > 0 ? productImages.slice(1) : (Array.isArray(product.images) ? product.images.slice(1) : []),
      size: productVariants.map((v: any) => `${v.size}:${v.price}`).join(', '),
      tag: productTag,
      categories: resolveCategoryNames(product, {} as Record<string, any[]>, oldCatMap.get((product as any).categoryId?.toString())),
      price: getPriceFromVariants(product, productVariants, product.discountPercentage),
      originalPrice: defaultVar?.price || 0,
      defaultVariantSize: defaultVar?.size || '50ml',
      discount: product.discountPercentage || 0,
      quantityInStock: productVariants.length > 0
        ? productVariants.reduce((sum: number, v: any) => sum + (v.quantityInStock || 0), 0)
        : (product.quantityInStock ?? product.stock ?? 1),
      reviewsCount,
      avgRating,
      rating: avgRating,
      flashSaleId: fsInfo?.id || '',
      flashSaleName: fsInfo?.name || '',
      flashSale: flashSaleDisplay,
    };
  });
}