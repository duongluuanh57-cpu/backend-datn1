import mongoose from 'mongoose';
import { VectorSearchService } from './VectorSearchService.ts';
import { Brand } from '../models/Brand.ts';
import { Product } from '../models/Product.ts';

/**
 * Keyword search — hybrid $text (inverted index) + $regex (prefix autocomplete)
 * 
 * Chiến lược:
 * 1. Dùng $text search trên Product (inverted index) — nhanh, chính xác
 * 2. Dùng $text search trên Brand (inverted index) — tìm brand
 * 3. Fallback $regex prefix cho autocomplete (khi gõ từng chữ)
 * 4. Kết hợp tất cả bằng RRF merge
 */
async function runKeywordSearch(query: string, limit: number) {
  const cleanQuery = query.toLowerCase().trim();
  const queryWords = cleanQuery.split(/\s+/).filter(w => w.length >= 2);
  if (queryWords.length === 0) return [];

  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const BUFFER = 2;

  // ── 1. Text search trên Product (inverted index) ──
  const textSearchProducts = Product.find(
    { $text: { $search: cleanQuery }, status: 'active' },
    { textScore: { $meta: 'textScore' } }
  )
    .sort({ textScore: { $meta: 'textScore' }, soldCount: -1 })
    .limit(limit * BUFFER)
    .lean()
    .then((docs: any[]) => docs.map(d => ({ ...d, _source: 'text' as const })))
    .catch(() => []);

  // ── 2. Search trên Brand (Tên hoặc Xuất xứ quốc gia) ──
  const originKeywords = ['việt nam', 'viet nam', 'vietnam', 'pháp', 'france', 'ý', 'italy', 'italia', 'mỹ', 'usa', 'anh', 'england', 'uk', 'đức', 'germany', 'nhật', 'japan', 'hàn', 'korea', 'oman'];
  const matchedOrigins = originKeywords.filter(k => cleanQuery.includes(k));
  const brandPattern = queryWords.map(w => '^' + escapeRegex(w)).join('|');

  const originFilter: any[] = [];
  if (matchedOrigins.length > 0) {
    originFilter.push({ origin: { $regex: matchedOrigins.join('|'), $options: 'i' } });
  }

  const brandSearch = Brand.find({
    $or: [
      { name: { $regex: brandPattern, $options: 'i' } },
      ...originFilter,
      { $text: { $search: cleanQuery } },
    ],
    status: 'active',
  })
    .select('_id name origin')
    .limit(5)
    .lean()
    .then((docs: any[]) => docs.map(d => ({ ...d, _source: 'brand' as const })))
    .catch(() => []);

  // ── 3. $regex prefix cho autocomplete ──
  const nameConditions = queryWords.map(word => ({
    name: { $regex: '^' + escapeRegex(word), $options: 'i' },
  }));

  const regexSearch = mongoose.connection.db!.collection('products').aggregate([
    { $match: { $or: nameConditions, status: 'active' } },
    { $sort: { soldCount: -1, rating: -1 } },
    { $limit: limit * BUFFER },
    { $lookup: { from: 'brands', localField: 'brandId', foreignField: '_id', as: 'brandData' } },
    { $unwind: { path: '$brandData', preserveNullAndEmptyArrays: true } },
    { $match: { $or: [...nameConditions, { 'brandData.name': { $regex: brandPattern, $options: 'i' } }] } },
    { $limit: limit },
    { $project: { _id: 1, name: 1, price: 1, description: 1, brand: '$brandData.name', brandId: 1, images: 1, variants: 1, rating: 1, soldCount: 1 } },
  ]).toArray().then((docs: any[]) => docs.map(d => ({ ...d, _source: 'regex' as const })));

  // ── Chạy song song ──
  const [textResults, brandResults, regexResults] = await Promise.all([
    textSearchProducts,
    brandSearch,
    regexSearch,
  ]);

  // ── Nếu có brand match, tìm product theo brandId ──
  const brandIds = brandResults.map((b: any) => b._id);
  let brandProductResults: any[] = [];
  if (brandIds.length > 0) {
    brandProductResults = await Product.find(
      { brandId: { $in: brandIds }, status: 'active' }
    )
      .sort({ soldCount: -1, rating: -1 })
      .limit(limit)
      .lean()
      .then((docs: any[]) => docs.map(d => ({ ...d, _source: 'brand' as const })));
  }

  // ── Format kết quả ──
  const formatProduct = (p: any) => ({
    _id: p._id,
    name: p.name,
    price: p.price,
    description: p.description || '',
    brand: p.brand || (p as any).brandData?.name || '',
    brandId: p.brandId,
    images: p.images || [],
    variants: p.variants || [],
    rating: p.rating || 0,
    soldCount: p.soldCount || 0,
  });

  const allResults = [
    ...textResults.map(formatProduct),
    ...brandProductResults.map(formatProduct),
    ...regexResults.map(formatProduct),
  ];

  // ── Dedup bằng Map ──
  const seen = new Map<string, any>();
  for (const item of allResults) {
    const id = item._id.toString();
    if (!seen.has(id)) seen.set(id, item);
  }

  return {
    products: Array.from(seen.values()).slice(0, limit),
    brands: brandResults.map((b: any) => ({ _id: b._id, name: b.name, origin: b.origin })),
  };
}

function extractPriceRange(query: string): { minPrice?: number; maxPrice?: number } | null {
  const clean = query.toLowerCase();

  // Dưới X triệu / X tr / X k
  const underMatch = clean.match(/(?:dưới|<|thấp hơn|nhỏ hơn|tối đa|max)\s*(\d+(?:[.,]\d+)?)\s*(tr|triệu|k|nghìn|ngàn|vnd|đ|dong|đồng)?/i);
  if (underMatch) {
    const num = parseFloat(underMatch[1].replace(',', '.'));
    const unit = underMatch[2] || 'tr';
    const multiplier = (unit.startsWith('k') || unit.startsWith('ng')) ? 1_000 : 1_000_000;
    return { maxPrice: num * multiplier };
  }

  // Trên X triệu / X tr
  const overMatch = clean.match(/(?:trên|>|cao hơn|lớn hơn|tối thiểu|min)\s*(\d+(?:[.,]\d+)?)\s*(tr|triệu|k|nghìn|ngàn|vnd|đ|dong|đồng)?/i);
  if (overMatch) {
    const num = parseFloat(overMatch[1].replace(',', '.'));
    const unit = overMatch[2] || 'tr';
    const multiplier = (unit.startsWith('k') || unit.startsWith('ng')) ? 1_000 : 1_000_000;
    return { minPrice: num * multiplier };
  }

  // Từ X đến Y (triệu / tr)
  const rangeMatch = clean.match(/(?:từ|khoảng|tầm)?\s*(\d+(?:[.,]\d+)?)\s*(?:đến|-|tới)\s*(\d+(?:[.,]\d+)?)\s*(tr|triệu|k|nghìn|ngàn|vnd|đ)?/i);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1].replace(',', '.'));
    const max = parseFloat(rangeMatch[2].replace(',', '.'));
    const unit = rangeMatch[3] || 'tr';
    const multiplier = (unit.startsWith('k') || unit.startsWith('ng')) ? 1_000 : 1_000_000;
    return { minPrice: min * multiplier, maxPrice: max * multiplier };
  }

  // Tầm / khoảng / giá X triệu / X tr
  const approxMatch = clean.match(/(?:tầm|khoảng|giá|mức giá)\s*(\d+(?:[.,]\d+)?)\s*(tr|triệu|k|nghìn|ngàn|vnd|đ)/i);
  if (approxMatch) {
    const num = parseFloat(approxMatch[1].replace(',', '.'));
    const unit = approxMatch[2] || 'tr';
    const multiplier = (unit.startsWith('k') || unit.startsWith('ng')) ? 1_000 : 1_000_000;
    const target = num * multiplier;
    return { minPrice: target * 0.7, maxPrice: target * 1.3 };
  }

  return null;
}

export class SearchService {
  static async hybridSearch(query: string, limit: number = 4) {
    try {
      const cleanQuery = query.toLowerCase().trim();
      if (!cleanQuery) return { products: [], brands: [], mode: 'general' };

      const confusionPatterns = [
        /^ủa+$/i, /^hả+$/i, /^gì(\s+vậy)?$/i,
        /^sao(\s+cơ)?$/i, /^ý(\s+là)?(\s+sao)?/i,
        /^cái(\s+gì)?$/i, /^đâu(\s+có)?/i,
        /^tại(\s+sao)?$/i, /^là(\s+sao)?$/i,
        /^ơ(\s+kìa)?/i, /^a(\s+là)?/i,
      ];

      if (confusionPatterns.some(p => p.test(cleanQuery))) {
        return { products: [], mode: 'confusion' };
      }

      const greetingPatterns = [
        /^(xin )?chào/i, /^hi+$/i, /^hello+$/i, /^hey+$/i,
        /^good (morning|afternoon|evening)/i,
        /^(chúc )?buổi (sáng|chiều|tối)/i,
        /^(bạn|mình) (có )?khỏe/i,
        /^(có ai|ai đó) (ở đây|không)/i,
        /^(cảm ơn|thanks|thank you)/i,
        /^tạm biệt|bye|goodbye/i,
      ];

      if (greetingPatterns.some(p => p.test(cleanQuery))) {
        return { products: [], mode: 'greeting' };
      }

      const vowelRatio = (cleanQuery.match(/[aeiouáàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ]/gi) || []).length / cleanQuery.length;
      const maxRepeat = Math.max(...(cleanQuery.match(/(.)\1+/g) || []).map(s => s.length));
      if (vowelRatio < 0.15 || maxRepeat >= 5 || /^[^aeiouy]{5,}$/i.test(cleanQuery.split(/\s+/).filter(Boolean).join(''))) {
        return { products: [], mode: 'gibberish' };
      }

      const queryWords = cleanQuery.split(/\s+/).filter(w => w.length >= 2);
      if (queryWords.length === 0) return { products: [], mode: 'general' };

      const priceRange = extractPriceRange(cleanQuery);

      const [vectorResults, keywordResults] = await Promise.all([
        VectorSearchService.searchProducts(cleanQuery, limit * 2).catch(() => [] as any[]),
        runKeywordSearch(cleanQuery, limit * 2),
      ]);

      const kwProducts = (keywordResults as any).products || [];
      const kwBrands = (keywordResults as any).brands || [];

      let candidates: any[] = [];
      if (vectorResults.length === 0) {
        candidates = kwProducts;
      } else {
        candidates = VectorSearchService.rrfMerge(vectorResults, kwProducts, 60, Math.max(limit * 3, 12));
      }

      // Nếu có yêu cầu về khoảng giá, ưu tiên các sản phẩm phù hợp mức giá đó
      if (priceRange) {
        const { minPrice, maxPrice } = priceRange;
        const matchesPrice = (p: any) => {
          const pVal = p.price ?? 0;
          if (pVal === 0) return true;
          if (minPrice !== undefined && pVal < minPrice) return false;
          if (maxPrice !== undefined && pVal > maxPrice) return false;
          return true;
        };

        const inPricePool = candidates.filter(matchesPrice);
        if (inPricePool.length > 0) {
          candidates = inPricePool;
        } else {
          // Nếu candidates từ keyword/vector không có chai nào trong tầm giá, query trực tiếp các sp active trong DB
          try {
            const fallbackPriceQuery: any = { status: 'active' };
            const fallbackDocs = await Product.find(fallbackPriceQuery)
              .sort({ soldCount: -1, createdAt: -1 })
              .limit(limit * 3)
              .populate('brandId', 'name')
              .lean();
            const matchingFallback = fallbackDocs.filter(matchesPrice);
            if (matchingFallback.length > 0) {
              candidates = matchingFallback;
            }
          } catch (_) {}
        }
      }

      // Đa dạng hóa kết quả: Nếu có nhiều sản phẩm phù hợp, chọn ngẫu nhiên trong nhóm top candidates
      let finalProducts = candidates;
      if (candidates.length > limit) {
        const topPool = candidates.slice(0, Math.min(candidates.length, limit + 6));
        for (let i = topPool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [topPool[i], topPool[j]] = [topPool[j], topPool[i]];
        }
        finalProducts = topPool.slice(0, limit);
      } else {
        finalProducts = candidates.slice(0, limit);
      }

      return { products: finalProducts, brands: kwBrands, mode: 'specific' };
    } catch (error: any) {
      console.error('❌ [SearchService Error]:', error.message);
      return { products: [], brands: [], mode: 'general' };
    }
  }
}
