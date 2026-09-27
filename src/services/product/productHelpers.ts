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

/** Số ml suy ra từ chuỗi size ('50ml' → 50, 'abc' → 0). */
export function parseCapacity(size: unknown): number {
  return parseInt(String(size ?? '').replace(/\D/g, ''), 10) || 0;
}

/**
 * Comparator sắp variant theo dung tích tăng dần (30ml → 50ml → 100ml).
 * Thay cho cột `sortOrder` đã bỏ: thứ tự suy ra trực tiếp từ `size`.
 */
export function bySizeAsc(a: any, b: any): number {
  return parseCapacity(a?.size) - parseCapacity(b?.size);
}

// Resolve tên danh mục từ product.categoryId (đã populate -> object có .name, hoặc string id).
export function resolveCategoryNames(
  product: any,
  terms?: Record<string, any[]>,
): string {
  const cat = (product as any).categoryId;
  if (cat && typeof cat === 'object' && cat.name) return cat.name;
  if (terms?.category?.length) {
    const names = terms.category.map((t: any) => t?.name).filter(Boolean);
    if (names.length > 0) return names.join(', ');
  }
  return '';
}