import mongoose from 'mongoose';
import { ProductImage } from '../../models/ProductImage.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { ProductTag } from '../../models/ProductTag.ts';
import { Tag } from '../../models/Tag.ts';
import { Category } from '../../models/Category.ts';
import { resolveCategoryNames } from './productHelpers.ts';

function getPriceFromVariants(productVariants: any[], discountPercentage?: number, discountStartDate?: Date | null, discountEndDate?: Date | null): number {
  const variant50ml = productVariants.find((v: any) => v.size === '50ml') || productVariants[0];
  if (!variant50ml) return 0;
  let price = variant50ml.price;
  if (discountPercentage && discountPercentage > 0) {
    const now = new Date();
    const startOk = !discountStartDate || new Date(discountStartDate) <= now;
    const endOk = !discountEndDate || new Date(discountEndDate) >= now;
    if (startOk && endOk) price = price * (1 - discountPercentage / 100);
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

  const allVariantIds = products.flatMap(p => (p.variants || []).map((v: any) => v.toString()));
  const variants = allVariantIds.length > 0
    ? await ProductVariant.find({ _id: { $in: allVariantIds } })
        .select('size price sortOrder quantityInStock').sort({ sortOrder: 1 }).lean() as any[]
    : [];
  const variantById = new Map<string, any>();
  for (const v of variants) variantById.set(v._id.toString(), v);

  // Lấy tag slugs trực tiếp qua ProductTag + Tag lookup (tránh populate overhead)
  const tagLinks = await ProductTag.find({ productId: { $in: productIds } })
    .select('productId tagId').lean() as any[];
  const allTagIds = [...new Set(tagLinks.map((l: any) => l.tagId?.toString()).filter(Boolean))];
  const tagDocs = allTagIds.length > 0
    ? await Tag.find({ _id: { $in: allTagIds } }).select('slug').lean() as any[]
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

  return products.map(product => {
    const pId = product._id.toString();
    const productImages = imageMap.get(pId) || [];
    const productVariants = (product.variants || [])
      .map((vId: any) => variantById.get(vId.toString())).filter(Boolean);

    return {
      ...product,
      brand: (product.brandId as any)?.name || '',
      image: productImages[0] || '',
      images: productImages.slice(1),
      size: productVariants.map((v: any) => `${v.size}:${v.price}`).join(', '),
      tag: (tagMap.get(pId) || []).join(', ') || (product as any).tag || '',
      categories: resolveCategoryNames(product, {} as Record<string, any[]>, oldCatMap.get((product as any).categoryId?.toString())),
      price: getPriceFromVariants(productVariants, product.discountPercentage, product.discountStartDate, product.discountEndDate),
      discount: product.discountPercentage || 0,
      quantityInStock: productVariants.reduce((sum: number, v: any) => sum + (v.quantityInStock || 0), 0),
    };
  });
}