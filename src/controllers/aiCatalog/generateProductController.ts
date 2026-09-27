import type { FastifyRequest, FastifyReply } from 'fastify';
import { AIService } from '../../services/AIService.ts';
import { SearchService } from '../../services/SearchService.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { extractAndFixJson } from './sanitizeJson.ts';
import { TAG_RULES, isLimitedTagRef } from '../../services/product/tagRules.ts';
import { descriptionMatchesName, distinctiveNameWords } from '../../services/product/nameConsistency.ts';

/**
 * POST /api/ai/admin/generate-product
 * AI tạo thông tin sản phẩm từ tên.
 * Brand chỉ được chọn từ danh sách brand active có sẵn; AI không được tạo brand mới.
 */

export async function generateProduct(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { name, availableBrands, availableTags, availableCategories } = req.body as {
      name: string;
      availableBrands?: string[];
      availableTags?: string[];
      availableCategories?: string[];
    };

    if (!name) {
      return reply.status(400).send({ error: 'Tên sản phẩm là bắt buộc' });
    }

    const brands = Array.isArray(availableBrands)
      ? availableBrands.map((brand) => String(brand).trim()).filter(Boolean).slice(0, 50)
      : [];
    const categories = Array.isArray(availableCategories)
      ? availableCategories.map((category) => String(category).trim()).filter(Boolean).slice(0, 50)
      : [];
    const tags = Array.isArray(availableTags)
      ? availableTags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 20)
      : [];
    const categoriesList = categories.join(', ');
    const brandsList = brands.join(', ');

    // Ground vào catalog: tra cứu brand/sản phẩm tương tự để AI điền sát thực tế shop.
    // Best-effort — nếu lỗi hoặc không có dữ liệu thì bỏ qua, AI vẫn hoạt động bình thường.
    let catalogContext = '';
    try {
      const { products: simProducts, brands: simBrands } = await SearchService.hybridSearch(name, 5);
      const brandHints = (Array.isArray(simBrands) ? simBrands : [])
        .map((b: any) => (b?.name ? `${b.name}${b?.origin ? ` (${b.origin})` : ''}` : ''))
        .filter(Boolean)
        .slice(0, 8);
      const priceList = await (async () => {
        const simIds = (Array.isArray(simProducts) ? simProducts : [])
          .map((p: any) => p?._id)
          .filter(Boolean);
        if (simIds.length === 0) return [] as number[];
        // Product không lưu giá cấp gốc — lấy giá thấp nhất mỗi biến thể làm mốc tham khảo.
        const rows = await ProductVariant.aggregate([
          { $match: { productId: { $in: simIds } } },
          { $group: { _id: '$productId', minPrice: { $min: '$price' } } },
        ]).catch(() => [] as any[]);
        return rows.map((r: any) => Number(r?.minPrice) || 0).filter((v: number) => v > 0);
      })();
      const sampleNames = (Array.isArray(simProducts) ? simProducts : [])
        .map((p: any) => p?.name)
        .filter(Boolean)
        .slice(0, 5);

      const lines: string[] = [];
      if (brandHints.length > 0) {
        lines.push(`- Brand liên quan đã có trong shop (kèm xuất xứ): ${brandHints.join('; ')}`);
      }
      if (sampleNames.length > 0) {
        lines.push(`- Sản phẩm tương tự đã có (để tham khảo văn phong/mức giá): ${sampleNames.join('; ')}`);
      }
      if (priceList.length > 0) {
        const min = Math.min(...priceList);
        const max = Math.max(...priceList);
        const avg = Math.round(priceList.reduce((a, b) => a + b, 0) / priceList.length);
        lines.push(`- Khoảng giá tham khảo trong shop: thấp nhất ~${min}đ, cao nhất ~${max}đ, trung bình ~${avg}đ. Hãy định giá các variants xoay quanh khoảng này (dung tích lớn hơn thì giá cao hơn).`);
      }
      if (lines.length > 0) {
        catalogContext = `\nDỮ LIỆU THAM KHẢO TỪ CATALOG CỦA SHOP (chỉ mang tính định hướng, KHÔNG bịa brand/category ngoài danh sách cho phép):\n${lines.join('\n')}\n`;
      }
    } catch (err) {
      console.warn('⚠️ [generateProduct] bỏ qua ground catalog:', (err as any)?.message);
    }

    const prompt = `Bạn đang giúp admin tạo sản phẩm nước hoa mới. Tên sản phẩm: "${name}"

HÃY ĐIỀN TOÀN BỘ THÔNG TIN CHO SẢN PHẨM NƯỚC HOA NÀY:
- brand: chọn đúng một brand đang hoạt động từ danh sách. Nếu không chắc, để trống.
- category: chọn đúng một category từ danh sách. Nếu không chắc, để trống.
- tag: CHỈ được để "limited" nếu đây là phiên bản giới hạn / sản xuất số lượng ít (Limited Edition, Special Edition, Collector's Edition, phát hành theo đợt); ngược lại để "".
- description: mô tả 2-3 câu về hương thơm.
- variants: mảng các dung tích, mỗi phần tử gồm size (vd "10ml","50ml","100ml"), price (giá VNĐ hợp lý), quantityInStock (số lượng tồn kho ước lượng, cứ bịa số hợp lý).
  NẾU tag = "limited" thì TỔNG quantityInStock của MỌI dung tích phải <= ${TAG_RULES.limitedMaxTotalStock} (ví dụ 1 dung tích duy nhất "100ml" với ${TAG_RULES.limitedMaxTotalStock}). Bản giới hạn mà tồn kho lớn hơn mức này sẽ không được tính là khan hiếm.
- longevity: độ lưu hương (vd "6 - 8 giờ")
- sillage: độ tỏa hương
- scentTrail: dấu vết hương để lại
- style: phong cách
- suitableFor: phù hợp với (Nam / Nữ / Unisex (Nam & Nữ))
- occasion: dịp sử dụng
- season: mùa phù hợp
- time: thời điểm (Ngày / Đêm / Ngày và Đêm)

DANH SÁCH BRAND ACTIVE ĐƯỢC PHÉP CHỌN: ${brandsList || '(không có)'}
DANH SÁCH CATEGORY ĐƯỢC PHÉP CHỌN: ${categoriesList || '(không có)'}
${catalogContext}
QUY TẮC BRAND:
- Tuyệt đối không tạo brand mới.
- Không tự đoán hoặc chỉnh sửa tên brand.
- Chỉ trả về một tên nằm nguyên văn trong danh sách brand active.
- Nếu không xác định được, để "brand": "".

QUY TẮC CATEGORY:
- Chỉ chọn đúng một category đã tồn tại trong danh sách category được cung cấp.
- Không tự tạo, viết tắt hoặc chỉnh sửa tên category.
- Trả về đúng nguyên văn tên category trong danh sách.
- Nếu không xác định được, để "category": "".

QUY TẮC TAG:
- Chỉ được trả về "limited" hoặc "".
- KHÔNG tự tạo tag khác. Các tag New / Bán chạy / Tiêu chuẩn / Giảm giá do hệ thống tự quản lý.

HÃY TRẢ LỀ THEO ĐỊNH DẠNG JSON (không markdown, không giải thích):
{
  "brand": "...",
  "category": "...",
  "tag": "",
  "description": "...",
  "variants": [
    { "size": "10ml", "price": 650000, "quantityInStock": 25 },
    { "size": "50ml", "price": 2450000, "quantityInStock": 20 },
    { "size": "100ml", "price": 3650000, "quantityInStock": 15 }
  ],
  "longevity": "...",
  "sillage": "...",
  "scentTrail": "...",
  "style": "...",
  "suitableFor": "...",
  "occasion": "...",
  "season": "...",
  "time": "..."
}`;

    const response = await AIService.generateResponse(prompt, undefined, 'gemini-3.1-flash-lite');
    const json = extractAndFixJson(response);
    const { brand: suggestedBrand, ...productData } = json;

    // Chỉ chấp nhận các giá trị taxonomy nằm trong danh sách frontend gửi lên.
    const findAllowedValue = (value: unknown, allowed: string[]): string | undefined => {
      const requested = String(value || '').trim().toLowerCase();
      if (!requested) return undefined;
      const exact = allowed.find((item) => item.toLowerCase() === requested);
      if (exact) return exact;
      return allowed.find((item) => {
        const normalized = item.toLowerCase();
        return normalized.includes(requested) || requested.includes(normalized);
      });
    };

    const requestedBrand = String(suggestedBrand || '').trim().toLowerCase();
    const matchedBrand = findAllowedValue(suggestedBrand, brands);
    if (matchedBrand && requestedBrand) {
      productData.brand = matchedBrand;
    }

    // Chuẩn hóa category từ các contract cũ (categories) và contract mới (category).
    const suggestedCategory = productData.category ?? productData.categories;
    delete productData.categories;
    const categoryParts = Array.isArray(suggestedCategory)
      ? suggestedCategory.map((value: unknown) => String(value).trim()).filter(Boolean)
      : String(suggestedCategory || '').split(',').map((value) => value.trim()).filter(Boolean);
    const matchedCategory = categoryParts
      .map((value: string) => findAllowedValue(value, categories))
      .find(Boolean);
    if (matchedCategory) {
      productData.category = matchedCategory;
    } else {
      delete productData.category;
    }

    // Tag: CHỈ chấp nhận "limited" — các tag khác do mô hình chuyển đổi tag tự quản lý.
    const suggestedTag = productData.tag ?? productData.tags;
    delete productData.tags;
    const limitedAllowed = tags.find((t) => isLimitedTagRef(t));
    const wantsLimited = isLimitedTagRef(suggestedTag);
    productData.tag = wantsLimited && limitedAllowed ? limitedAllowed : '';

    // Gỡ các field không còn dùng (AI có thể trả dư theo contract cũ).
    for (const unused of ['price', 'discountPercentage', 'volume', 'scentGroup', 'gender', 'ingredients', 'size']) {
      delete productData[unused];
    }

    // Chuẩn hóa variants: size + price + quantityInStock (tồn kho AI tự ước lượng).
    const rawVariants = Array.isArray(productData.variants) ? productData.variants : [];
    productData.variants = rawVariants
      .slice(0, 12)
      .map((v: any) => ({
        size: String(v?.size ?? '').trim() || '50ml',
        price: Math.max(0, Math.round(Number(v?.price) || 0)),
        quantityInStock: Math.max(0, Math.round(Number(v?.quantityInStock) || 0)),
      }))
      .filter((v: any) => v.size);

    // Bản giới hạn phải lọt luật Limited: tổng tồn kho <= TAG_RULES.limitedMaxTotalStock.
    // AI được lệnh vậy nhưng vẫn có thể trả thừa, nên ép lại ở đây — phần dư dồn vào
    // biến thể giá cao nhất (thường là dung tích lớn nhất) để không vượt trần.
    if (productData.tag && productData.variants.length > 0) {
      const cap = TAG_RULES.limitedMaxTotalStock;
      const total = productData.variants.reduce((sum: number, v: any) => sum + v.quantityInStock, 0);
      if (total > cap) {
        let assigned = 0;
        for (const v of productData.variants) {
          v.quantityInStock = Math.floor((v.quantityInStock * cap) / total);
          assigned += v.quantityInStock;
        }
        const topVariant = productData.variants.reduce((a: any, b: any) => (b.price > a.price ? b : a));
        topVariant.quantityInStock += cap - assigned;
      }
    }

    // Các trường mô tả / thông số mùi: ép về chuỗi gọn gàng.
    for (const key of ['description', 'longevity', 'sillage', 'scentTrail', 'style', 'suitableFor', 'occasion', 'season', 'time']) {
      if (productData[key] != null) productData[key] = String(productData[key]).trim();
    }

    // Mô tả AI hay "mượn" văn phong sản phẩm tương tự trong prompt rồi ghi luôn tên chai khác
    // ("Creed Aventus Absolu" nhận đoạn mô tả của "Creed Spring Flower"). Ghi bừa là khách đọc sai hàng.
    const warnings: string[] = [];
    const description = String(productData.description || '');
    const signatureWords = distinctiveNameWords(productData.name || name, productData.brand);
    if (description && !descriptionMatchesName(description, signatureWords)) {
      console.warn(`⚠️ [generateProduct] Mô tả trả về không nhắc tới "${name}", bỏ mô tả để admin viết lại`);
      productData.description = '';
      warnings.push('Mô tả AI trả về nói về sản phẩm khác nên đã bị loại — hãy kiểm tra và viết lại mô tả.');
    }

    return reply.send({
      success: true,
      data: productData,
      warnings,
    });
  } catch (error: any) {
    console.error('❌ [generateProduct] Error:', error);
    return reply.status(500).send({ error: 'Lỗi khi tạo thông tin sản phẩm: ' + error.message });
  }
}
