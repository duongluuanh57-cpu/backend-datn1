import type { FastifyRequest, FastifyReply } from 'fastify';
import { AIService } from '../../services/AIService.ts';
import { Product } from '../../models/Product.ts';
import { Brand } from '../../models/Brand.ts';
import { Category } from '../../models/Category.ts';
import { Tag } from '../../models/Tag.ts';
import { ProductImage } from '../../models/ProductImage.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { ProductTag } from '../../models/ProductTag.ts';
import { extractAndFixJson } from './sanitizeJson.ts';

/**
 * POST /api/ai/admin/product-fill-missing
 * Input: { productId: string }
 * Output: { success, data } — data chứa các trường còn trống đã được AI điền
 */
export async function productFillMissing(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { productId, currentSizes } = req.body as { productId: string; currentSizes?: string[] };
    if (!productId) {
      return reply.status(400).send({ success: false, message: 'productId is required' });
    }

    const product = await Product.findById(productId)
      .populate('brandId')
      .populate('categories')
      .lean() as any;
    if (!product) {
      return reply.status(404).send({ success: false, message: 'Product not found' });
    }

    const images = await ProductImage.find({ productId }).lean();
    const variantIds = (product.variants || []) as any[];
    const variants = variantIds.length > 0
      ? await ProductVariant.find({ _id: { $in: variantIds } }).sort({ sortOrder: 1 }).lean()
      : [];

    const tagLinks = await ProductTag.find({ productId })
      .populate({ path: 'tagId', model: 'Tag', select: 'name slug' })
      .lean();
    const tagNames = tagLinks.map((l: any) => l.tagId?.name).filter(Boolean);

    const brandName = (product.brandId as any)?.name || '';
    const catNames = (product.categories as any[] || []).map((c: any) => c?.name || '').filter(Boolean);

    // Xác định trường thiếu
    const missing: string[] = [];
    if (!product.name?.trim()) missing.push('name');
    if (!brandName) missing.push('brand');
    if (!(product.description?.trim()?.length >= 50)) missing.push('description');
    if (!catNames.length) missing.push('categories');
    if (!tagNames.length) missing.push('tags');
    const hasIncompleteVariant = variants.length === 0 || variants.some((v: any) => !v.price || v.price <= 0);
    if (hasIncompleteVariant) missing.push('variants');
    if (!product.longevity) missing.push('longevity');
    if (!product.sillage) missing.push('sillage');
    if (!product.scentTrail) missing.push('scentTrail');
    if (!product.style) missing.push('style');
    if (!product.suitableFor) missing.push('suitableFor');
    if (!product.occasion) missing.push('occasion');
    if (!product.season) missing.push('season');
    if (!product.time) missing.push('time');

    // Nếu discount đang trống/null → thêm vào danh sách cần điền
    if (!product.discountPercentage || product.discountPercentage === 0) {
      if (missing.indexOf('discountPercentage') === -1) missing.push('discountPercentage');
    }

    if (!missing.length) {
      return reply.send({ success: true, data: {}, message: 'Không có trường nào bị thiếu' });
    }

    const [allBrands, allCategories] = await Promise.all([
      Brand.find({ status: 'active' }).lean(),
      Category.find({ status: 'active' }).lean(),
    ]);

    const existingVariantsStr = variants.length > 0
      ? variants.map((v: any) => `${v.size || '?'}:${v.price || 0}₫ (tồn: ${v.quantityInStock || 0})`).join('; ')
      : 'chưa có';

    const prompt = `Bạn là chuyên gia nước hoa. Hãy điền CÁC TRƯỜNG CÒN THIẾU cho sản phẩm nước hoa sau.

THÔNG TIN HIỆN TẠI:
- Tên: ${product.name || '(trống)'}
- Thương hiệu: ${brandName || '(trống)'}
- Danh mục: ${catNames.join(', ') || '(trống)'}
- Tags: ${tagNames.join(', ') || '(trống)'}
- Mô tả hiện tại: ${(product.description || '').substring(0, 200)}
- Biến thể hiện có: ${existingVariantsStr}
${currentSizes && currentSizes.length ? `- CÁC DUNG TÍCH (SIZES) YÊU CẦU ĐỊNH GIÁ & ĐIỀN TỒN KHO: ${currentSizes.join(', ')}` : ''}
- Giảm giá: ${product.discountPercentage || 0}%
- Độ lưu hương: ${product.longevity || '(trống)'}
- Độ tỏa hương: ${product.sillage || '(trống)'}
- Hương đặc trưng: ${product.scentTrail || '(trống)'}
- Phong cách: ${product.style || '(trống)'}
- Phù hợp: ${product.suitableFor || '(trống)'}
- Dịp: ${product.occasion || '(trống)'}
- Mùa: ${product.season || '(trống)'}
- Thời điểm: ${product.time || '(trống)'}

DANH SÁCH TRƯỜNG CẦN ĐIỀN (chỉ điền các trường đang thiếu): ${missing.join(', ')}

QUY TẮC TÍNH GIẢM GIÁ (nếu cần điền discountPercentage):
- Tag "limited/giới hạn": giá 50ml > 3.000.000 → 0-5%, giá ≤ 3.000.000 → 5-10%
- Tag "trending/bán chạy": 0-5%
- Tag "new/sản phẩm mới": 5-15%
- Tag "sale": 20-50% + PHẢI có discountStartDate & discountEndDate
- Không tag đặc biệt: giá 50ml < 1.000.000 → 10-20%, giá 1.000.000-3.000.000 → 5-10%, giá > 3.000.000 → 0-5%
- Nếu discount > 10% → PHẢI có discountStartDate & discountEndDate

THƯƠNG HIỆU CÓ SẴN TRONG DB: ${allBrands.map((b: any) => b.name).join(', ')}

DANH MỤC CÓ SẴN TRONG DB: ${allCategories.map((c: any) => c.name).join(', ')}

CÁC SIZE NƯỚC HOA PHỔ BIẾN: 2ml, 5ml, 10ml, 30ml, 50ml, 75ml, 100ml, 125ml, 150ml

YÊU CẦU:
- Trả về JSON thuần (không markdown, không code block)
- Chỉ include các trường trong danh sách cần điền
- Với brand: dùng TÊN CHÍNH XÁC từ danh sách có sẵn
- Với categories: dùng TÊN CHÍNH XÁC từ danh sách có sẵn, cách nhau bằng dấu phẩy
- Với variants: object array dạng [{size: "50ml", price: 0, quantityInStock: 0}]
- Với description: Viết tiếng Việt gồm ĐÚNG 3 đoạn văn in đậm (**...**). Mỗi đoạn cách nhau 1 dòng trống (\n\n). 
  Đoạn 1 (**...**): Giới thiệu sản phẩm, cảm hứng sáng tạo và di sản nam tính/nữ tính.
  Đoạn 2 (**...**): Mô tả chi tiết hành trình mùi hương từ tầng hương đầu, hương giữa đến tầng hương cuối.
  Đoạn 3 (**...**): Mô tả thiết kế chai, phong cách sống và khẳng định đây là món phụ kiện không thể thiếu.
  VÍ DỤ MÔ TẢ ĐÚNG CHUẨN (PHẢI THEO CẤU TRÚC NÀY):
  **Dolce & Gabbana Devotion Pour Homme EDP là chương mới đầy cảm xúc trong hành trình chinh phục những giá trị nam tính đích thực. Mang trong mình tinh thần Ý phóng khoáng và sang trọng, đây là biểu tượng của sự tận tụy và đam mê, được chế tác tỉ mỉ để tôn vinh vẻ đẹp mạnh mẽ nhưng cũng đầy chiều sâu của phái mạnh trong thế giới hiện đại.**

  **Mùi hương mở đầu với sự bùng nổ của cam quýt tươi mát, ngay lập tức đánh thức mọi giác quan bằng năng lượng tích cực và rạng rỡ. Khi hương giữa lắng đọng, sự kết hợp giữa các nốt hương gia vị ấm áp và gỗ đàn hương tạo nên một bản giao hưởng hoàn hảo, vừa bí ẩn vừa cuốn hút, để lại dấu ấn khó quên trên làn da suốt cả ngày dài.**

  **Với thiết kế chai ấn tượng mang đậm dấu ấn nghệ thuật của nhà Dolce & Gabbana, sản phẩm này không chỉ là một mùi hương, mà còn là một tuyên ngôn về phong cách sống tự do và đẳng cấp. Đây chắc chắn là mảnh ghép không thể thiếu cho những quý ông đang tìm kiếm một người bạn đồng hành tinh tế, sẵn sàng tỏa sáng trong mọi hoàn cảnh từ công sở cho đến những buổi dạ tiệc tối.**

- longevity, sillage: ví dụ "6-8 tiếng", "Toả hương mạnh"
- scentTrail: mô tả hương đặc trưng
- style, suitableFor, occasion, season, time: chuỗi ngắn gọn

VÍ DỤ JSON OUTPUT:
${JSON.stringify({
  description: '**Đoạn 1...**\n\n**Đoạn 2...**\n\n**Đoạn 3...**',
  longevity: '6-8 tiếng',
  sillage: 'Toả hương 1 cánh tay',
  scentTrail: 'Hương gỗ, Cam quýt',
}, null, 2)}`;

    let jsonString = '';
    try {
      const raw = await AIService.generateResponse(prompt, undefined, 'gemini-3.1-flash-lite');
      jsonString = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();
    } catch (err: any) {
      console.warn(`⚠️ [AI FillMissing Retry] ${err.message}`);
      const raw = await AIService.generateResponse(prompt, undefined, 'gemini-3.1-flash-lite');
      jsonString = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();
    }

    let result: any;
    try {
      result = extractAndFixJson(jsonString);
    } catch (parseError: any) {
      return reply.status(500).send({
        success: false,
        message: 'AI trả về JSON không hợp lệ',
        rawResponse: jsonString.substring(0, 500),
      });
    }

    return reply.send({ success: true, data: result });
  } catch (error: any) {
    console.error('❌ [productFillMissing] Error:', error);
    return reply.status(500).send({ success: false, message: error.message });
  }
}