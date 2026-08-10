import type { FastifyRequest, FastifyReply } from 'fastify';
import { AIService } from '../../services/AIService.ts';
import { Tag } from '../../models/Tag.ts';
import { Brand } from '../../models/Brand.ts';
import { Category } from '../../models/Category.ts';
import { FuzzyMatchCache } from '../../services/FuzzyMatchCache.ts';
import { extractAndFixJson } from './sanitizeJson.ts';
import { buildProductPrompt } from './productPromptBuilder.ts';
import { resolveTags, resolveBrand, resolveCategories, type TaxonomyContext } from './productTaxonomyResolver.ts';

/**
 * Generate product info using AI (single-stage Gemini)
 *
 * Đã refactor — logic tách ra các module:
 *   - productPromptBuilder.ts   → Xây dựng prompt
 *   - productTaxonomyResolver.ts → Resolve tag/brand/category
 */
export async function generateProduct(req: FastifyRequest, reply: FastifyReply) {
  try {
    const {
      name,
      brand,
      price,
      size,
      description,
      tag,
      quantityInStock,
      discountPercentage,
      metaTitle,
      metaDescription,
      keywords,
      image,
      longevity,
      sillage,
      durability,
      scentTrail,
      style,
      suitableFor,
      occasion,
      availableBrands,
      availableCategories,
      availableSizes,
      availableTags
    } = req.body as {
      name: string;
      brand?: string;
      price?: number;
      size?: string;
      description?: string;
      tag?: string;
      quantityInStock?: number;
      discountPercentage?: number;
      metaTitle?: string;
      metaDescription?: string;
      keywords?: string;
      image?: string;
      longevity?: string;
      sillage?: string;
      durability?: string;
      scentTrail?: string;
      style?: string;
      suitableFor?: string;
      occasion?: string;
      availableBrands?: string[];
      availableCategories?: string[];
      availableSizes?: string[];
      availableTags?: string[];
    };

    if (!name) return reply.status(400).send({ success: false, message: 'Name is required' });

    // Build pre-filled context
    const preFilled: Record<string, any> = {};
    if (brand?.trim()) preFilled.brand = brand.trim();
    if (price && price > 0) preFilled.price = price;
    if (size?.trim()) preFilled.size = size.trim();
    if (description?.trim()) preFilled.description = description.trim();
    if (quantityInStock && quantityInStock > 0) preFilled.quantityInStock = quantityInStock;
    if (image?.trim()) preFilled.image = image.trim();
    if (longevity?.trim()) preFilled.longevity = longevity.trim();
    if (sillage?.trim()) preFilled.sillage = sillage.trim();
    if (durability?.trim()) preFilled.durability = durability.trim();
    if (scentTrail?.trim()) preFilled.scentTrail = scentTrail.trim();
    if (style?.trim()) preFilled.style = style.trim();
    if (suitableFor?.trim()) preFilled.suitableFor = suitableFor.trim();
    if (occasion?.trim()) preFilled.occasion = occasion.trim();

    const sizesJson = JSON.stringify(
      availableSizes || ['2ml', '5ml', '10ml', '30ml', '50ml', '75ml', '100ml', '125ml', '150ml']
    );

    console.log(`🚀 [AI generateProduct] Loading tags & brands (cached) for: ${name}`);

    // ── DB Lookups ──
    const [allTags, allBrands, allCategories] = await Promise.all([
      FuzzyMatchCache.getOrFetch('tags:active', () =>
        Tag.find({ status: 'active' }).lean()
      ),
      FuzzyMatchCache.getOrFetch('brands:active', () =>
        Brand.find({ status: 'active' }).lean()
      ),
      FuzzyMatchCache.getOrFetch('categories:active', () =>
        Category.find({ status: 'active' }).lean()
      ),
    ]);

    const taxonomyCtx: TaxonomyContext = { allTags, allBrands, allCategories };

    // Lọc availableTags — chỉ gửi tag đang tồn tại trong DB
    const activeTagNamesFromDb = new Set(Array.from(allTags.lookup.values()).map((t: any) => t.name));
    const filteredTags = (availableTags || []).filter((t: string) => activeTagNamesFromDb.has(t));
    const finalTagsForPrompt = filteredTags.length > 0
      ? filteredTags
      : Array.from(allTags.lookup.values())
          .filter((t: any) => t.name.toLowerCase() !== 'standard')
          .map((t: any) => t.name);

    // ── Build prompt & call AI ──
    console.log(`🧠 [AI generateProduct] Single-stage generation with Gemini 3.1 Flash Lite for: ${name}`);

    const singleStagePrompt = buildProductPrompt({
      name,
      availableBrands: availableBrands || [],
      availableCategories: availableCategories || [],
      availableTags: finalTagsForPrompt,
      sizesJson,
      preFilled,
    });

    let jsonString = '';
    try {
      const raw = await AIService.generateResponse(singleStagePrompt, undefined, 'gemini-3.1-flash-lite');
      jsonString = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();
    } catch (err: any) {
      console.warn(`⚠️ [AI Retry] ${err.message}`);
      const raw = await AIService.generateResponse(singleStagePrompt, undefined, 'gemini-3.1-flash-lite');
      jsonString = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();
    }

    // ── Parse JSON ──
    let productInfo: any;
    try {
      console.log(`📝 [AI Raw JSON] Length: ${jsonString.length} chars`);
      productInfo = extractAndFixJson(jsonString);
      console.log(`✅ [AI JSON] Successfully parsed`);
    } catch (parseError: any) {
      console.error(`❌ [AI JSON Parse Failed] ${parseError.message}`);
      return reply.status(500).send({
        success: false,
        message: 'AI trả về JSON không hợp lệ',
        details: parseError.message,
        rawResponse: jsonString.substring(0, 500)
      });
    }

    // ── Price từ size 50ml ──
    let priceFromSize = 0;
    const sizeStr = String(productInfo.size || '');
    sizeStr.split(',').forEach((s: string) => {
      const parts = s.trim().split(':');
      if (parts.length < 2) return;
      const label = parts[0].toLowerCase().replace(/\s/g, '');
      const val = Number(parts[1]) || 0;
      if (!priceFromSize) priceFromSize = val;
      if (label === '50ml' || label === '50' || /^50/.test(label)) priceFromSize = val;
    });
    console.log(`[AI Price] size="${sizeStr}" → priceFromSize=${priceFromSize}`);
    productInfo.price = priceFromSize;

    // ── Resolve taxonomy (tag, brand, category) ──
    const hasValidSale = (productInfo.discountPercentage > 10 && productInfo.discountEndDate);

    // Tags
    const { tagIds, tagNames } = resolveTags(productInfo.tag, hasValidSale, taxonomyCtx);
    if (tagIds.length > 0) {
      productInfo.tags = tagIds;
      productInfo.tag = tagNames.join(',');
    } else {
      delete productInfo.tag;
    }

    // Brand
    const { brandId, brandName } = resolveBrand(productInfo.brand, taxonomyCtx);
    if (brandId) productInfo.brandId = brandId;
    if (brandName) productInfo.brand = brandName;

    // Categories
    const { categoryIds, categoryNames } = resolveCategories(productInfo.category, taxonomyCtx);
    productInfo.categories = categoryIds;
    productInfo.category = categoryNames.join(', ');

    // Ảnh: không tự gán, để null cho admin tự thêm
    productInfo.image = preFilled.image || null;

    console.log(`✅ [AI generateProduct] Done in single stage for: ${name}`);
    return reply.status(200).send({ success: true, data: productInfo });
  } catch (error: any) {
    console.error('AI Product Generation Error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
}