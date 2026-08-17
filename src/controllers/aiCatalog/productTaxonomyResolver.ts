/**
 * productTaxonomyResolver — Resolve tag, brand, category từ AI output sang DB entities
 */
import { FuzzyMatchCache } from '../../services/FuzzyMatchCache.ts';

export interface TaxonomyContext {
  allTags: { lookup: Map<string, any>; items: any[] };
  allBrands: { lookup: Map<string, any>; items: any[] };
  allCategories: { lookup: Map<string, any>; items: any[] };
}

/**
 * Resolve tags từ AI output: Standard + 1 tag do AI chọn (hoặc random nếu thiếu)
 */
/**
 * Resolve tags từ AI output: Bắt buộc có Standard và tối đa đúng 2 tags
 */
export function resolveTags(
  aiTag: string | undefined,
  hasValidSale: boolean,
  ctx: TaxonomyContext
): { tagIds: any[]; tagNames: string[] } {
  const tagIds: any[] = [];
  const tagNames: string[] = [];
  const standardTag = ctx.allTags.lookup.get('standard');
  const saleTagEntry = ctx.allTags.lookup.get('sale');

  // 1. Standard tag bắt buộc phải có
  if (standardTag) {
    tagIds.push(standardTag._id);
    tagNames.push(standardTag.name);
    console.log(`✅ Standard tag auto-added: ${standardTag.name}`);
  }

  // 2. Xác định tag thứ 2 (chỉ lấy đúng 1 tag thứ hai để tối đa là 2)
  let secondTag: any = null;

  if (hasValidSale && saleTagEntry) {
    secondTag = saleTagEntry;
    console.log(`✅ Sale tag selected due to valid sale`);
  } else if (aiTag) {
    const matched = FuzzyMatchCache.fuzzyFind(aiTag, ctx.allTags.lookup, (t: any) => t.name);
    if (matched && FuzzyMatchCache.normalize(matched.name) !== 'standard') {
      const isSale = FuzzyMatchCache.normalize(matched.name) === 'sale';
      if (isSale) {
        if (hasValidSale && saleTagEntry) {
          secondTag = saleTagEntry;
        }
      } else {
        secondTag = matched;
      }
    }
  }

  // 3. Fallback: Nếu chưa tìm được tag thứ 2, chọn tag đầu tiên khác standard/sale
  if (!secondTag) {
    for (const [norm, tag] of ctx.allTags.lookup) {
      if (norm === 'standard' || norm === 'sale') continue;
      secondTag = tag;
      console.log(`✅ Extra tag auto-added (fallback): ${tag.name}`);
      break;
    }
  }

  // Thêm tag thứ 2 vào mảng trả về
  if (secondTag) {
    tagIds.push(secondTag._id);
    tagNames.push(secondTag.name);
    console.log(`✅ Second tag resolved: ${secondTag.name}`);
  }

  return { tagIds, tagNames };
}

/**
 * Resolve brand từ tên AI output → ObjectId trong DB
 */
export function resolveBrand(
  brandName: string | undefined,
  ctx: TaxonomyContext
): { brandId?: any; brandName?: string } {
  if (!brandName) return {};

  const matched = FuzzyMatchCache.fuzzyFind(brandName, ctx.allBrands.lookup, (b: any) => b.name);
  if (matched) {
    console.log(`✅ Brand resolved: ${matched.name} (ID: ${matched._id})`);
    return { brandId: matched._id, brandName: matched.name };
  }

  console.warn(`⚠️ Brand "${brandName}" not found in database, keeping as-is`);
  return { brandName };
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