/**
 * productTaxonomyResolver — Resolve tag và category từ AI output sang DB entities
 */
import { FuzzyMatchCache } from '../../services/FuzzyMatchCache.ts';

export interface TaxonomyContext {
  allTags: { lookup: Map<string, any>; items: any[] };
  allCategories: { lookup: Map<string, any>; items: any[] };
}

/**
 * Resolve tags từ AI output: Standard + 1 tag do AI chọn (hoặc random nếu thiếu)
 */
/**
 * Resolve tags từ AI output:
 * - Nếu sản phẩm được xác định là Limited (isLimited = true hoặc aiTag chứa "limited") -> Gán duy nhất Tag Limited
 * - Nếu không phải Limited -> KHÔNG GÁN BẤT KỲ TAG NÀO (rỗng)
 */
export function resolveTags(
  aiTag: string | undefined,
  isLimited: boolean | undefined,
  ctx: TaxonomyContext
): { tagIds: any[]; tagNames: string[] } {
  const isLimitedProduct = isLimited === true || (typeof aiTag === 'string' && aiTag.trim().toLowerCase().includes('limited'));

  if (isLimitedProduct) {
    const limitedTag = Array.from(ctx.allTags.lookup.values()).find(
      (t: any) => t.slug?.toLowerCase() === 'limited' || t.name?.toLowerCase() === 'limited'
    );
    if (limitedTag) {
      console.log(`✅ [AI Tag] Sản phẩm được thẩm định là Limited Edition → Gán Tag: ${limitedTag.name}`);
      return { tagIds: [limitedTag._id], tagNames: [limitedTag.name] };
    }
  }

  console.log(`ℹ️ [AI Tag] Sản phẩm là bản thông thường (không phải Limited) → Không gán tag gì hết`);
  return { tagIds: [], tagNames: [] };
}

/**
 * Resolve categories từ AI output → ObjectId array (đảm bảo tối thiểu 1, tối đa 1)
 */
export function resolveCategories(
  aiCategory: string | undefined,
  ctx: TaxonomyContext
): { categoryIds: any[]; categoryNames: string[] } {
  const catNames: string[] = [];
  const catIds: any[] = [];

  // 1. Parse từ AI output
  if (aiCategory) {
    const names = String(aiCategory).split(',').map((s: string) => s.trim()).filter(Boolean);
    const matched = names
      .map(n => FuzzyMatchCache.fuzzyFind(n, ctx.allCategories.lookup, (c: any) => c.name))
      .filter(Boolean);
    for (const c of matched) {
      if (!catNames.includes(c.name)) {
        catNames.push(c.name);
        catIds.push(c._id);
        break; // Chỉ lấy tối đa 1 danh mục
      }
    }
  }

  // 2. Fallback: fill đủ 1 nếu thiếu
  if (catIds.length === 0) {
    for (const c of (ctx.allCategories.items || [])) {
      if (catNames.length >= 1) break;
      if (!catNames.includes(c.name)) {
        catNames.push(c.name);
        catIds.push(c._id);
      }
    }
  }

  if (catNames.length > 0) {
    console.log(`✅ category resolved: ${catNames.join(', ')}`);
  } else {
    console.warn(`⚠️ No categories found in database`);
  }

  return { categoryIds: catIds, categoryNames: catNames };
}