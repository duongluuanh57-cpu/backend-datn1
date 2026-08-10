import { slugify as _slugify } from '../../utils/textNormalizer.ts';

/** Slugify cho product — wrapper với fallback 'product' */
export function slugify(text: string): string {
  return _slugify(text) || 'product';
}

// Helper sizes parsing
export function parseSizes(sizeStr: string): { size: string; price: number; quantityInStock?: number }[] {
  if (!sizeStr) return [];
  return sizeStr.split(',').map(s => {
    const parts = s.trim().split(':');
    const sizeName = parts[0]?.trim();
    const priceVal = Number(parts[1]?.trim()?.replace(/[^0-9.-]/g, '')) || 0;
    const qtyVal = parts[2] !== undefined ? (Number(parts[2]?.trim()?.replace(/[^0-9.-]/g, '')) || 0) : undefined;
    return { size: sizeName, price: priceVal, quantityInStock: qtyVal };
  }).filter(item => item.size);
}

// Resolve category names from multiple sources (old + new format)
export function resolveCategoryNames(
  product: any,
  terms?: Record<string, any[]>,
  oldCategoryName?: string,
): string {
  if ((product.categories as any[])?.length > 0) {
    const names = (product.categories as any[]).map((c: any) => c?.name).filter(Boolean);
    if (names.length > 0) return names.join(', ');
  }
  if (oldCategoryName) return oldCategoryName;
  const fallback = (product as any).categoryId || (product as any).category;
  if (fallback && typeof fallback === 'string') return fallback;
  if (terms?.category?.length) {
    const names = terms.category.map((t: any) => t?.name).filter(Boolean);
    if (names.length > 0) return names.join(', ');
  }
  return '';
}