/**
 * POST /api/ai/chat
 * Chat — dùng QueryRouter để phân loại và xử lý câu hỏi
 * 
 * Query Router phân tích câu hỏi → chọn đúng data source:
 * - Vector Search: tìm theo mùi hương, cảm xúc
 * - SQL/MongoDB: tìm theo tên, hãng, giá
 * - Web Search: tra cứu tin tức, xu hướng
 * - Graph Search: gợi ý sản phẩm liên quan
 * - Admin Query: thống kê quản trị (chỉ ADMIN)
 * 
 * Greeting/Confusion/Gibberish được xử lý trực tiếp, không gọi AI.
 */
import { Readable } from 'node:stream';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { QueryRouterService } from '../../services/queryRouter/QueryRouterService.ts';
import type { UserRole } from '../../services/queryRouter/queryRouterTypes.ts';

/**
 * POST /api/ai/chat
 * User Chat — sử dụng Query Router
 */
export async function chatStream(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { messages, image } = req.body as { messages: any[], image?: string };
    const userRole = ((req as any).user?.role || undefined) as UserRole;

    if ((!messages || !Array.isArray(messages)) && !image) {
      return reply.status(400).send({ error: 'Messages or Image required' });
    }

    const lastMessage = messages[messages.length - 1]?.content || (image ? 'Nhận diện sản phẩm nước hoa trong ảnh giúp tôi' : '');
    if (!lastMessage && !image) throw new Error('Empty message');

    // ── HÌNH ẢNH: fallback sang direct stream với AI Vision & Catalog Context ──
    if (image) {
      console.log(`📸 [chatStream] Image detected — analyzing perfume with AI Vision`);
      return handleImageStream(req, reply, messages, image);
    }

    // ── Query Routing ──
    const result = await QueryRouterService.route({
      message: lastMessage,
      messages,
      image,
      userRole,
    });

    // ── Trả về kết quả ──
    if (result.type === 'direct' && result.content) {
      return reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .status(200)
        .send(result.content);
    }

    if (result.type === 'stream' && result.streamResponse) {
      const fb = result.streamResponse;
      if (!fb.body) throw new Error('No body from AI');

      return reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .header('Cache-Control', 'no-cache, no-transform')
        .header('X-Accel-Buffering', 'no')
        .send(Readable.fromWeb(fb.body as any));
    }

    // Fallback
    return reply.status(500).send({ error: 'No response generated' });

  } catch (error: any) {
    console.error('❌ [chatStream Error]:', error);
    return reply.status(500).send({ error: error.message || 'Internal Server Error' });
  }
}

/**
 * Xử lý hình ảnh riêng — gọi Gemini Vision + Catalog Context
 */
async function handleImageStream(
  req: FastifyRequest,
  reply: FastifyReply,
  messages: any[],
  image: string
) {
  const { AIService } = await import('../../services/AIService.ts');
  const { Product } = await import('../../models/Product.ts');

  let storeCatalogContext = '';
  try {
    const products = await Product.find({ status: 'active' })
      .populate('brandId', 'name origin')
      .select('name brandId price discountPercentage description')
      .lean();

    if (products.length > 0) {
      storeCatalogContext = `\nDANH MỤC SẢN PHẨM HIỆN CÓ CỦA CỬA HÀNG L'ESSENCE:\n` +
        products.map((p: any) => {
          const brandName = p.brandId?.name || 'Chính hãng';
          const priceStr = p.price ? `${p.price.toLocaleString('vi-VN')}đ` : 'Giá ưu đãi';
          return `- **${p.name}** (Hãng: ${brandName} | Giá: ${priceStr}) [CARD:${p._id}]`;
        }).join('\n');
    }
  } catch (err) {
    console.error('❌ [handleImageStream] Error fetching store products:', err);
  }

  const visionSystemPrompt = `Bạn là Tinco - Trợ lý Chuyên gia Nước hoa & AI Vision của L'essence.
Nhiệm vụ của bạn là phân tích hình ảnh chai nước hoa do người dùng chụp/tải lên một cách CHÍNH XÁC, TẬN TÂM và CHUYÊN NGHIỆP:

QUY TRÌNH PHÂN TÍCH HÌNH ẢNH NƯỚC HOA:
1. ĐỌC KỸ CHỮ TRÊN CHAI/NHÃN DÁN/VỎ HỘP (OCR):
   - Đọc kỹ tất cả chữ in trên thân chai nước hoa (Tên thương hiệu, Tên dòng nước hoa, Nồng độ như EDP/EDT/Parfum, Dung tích...).
   - ĐẶC BIỆT CHÚ Ý TÊN THƯƠNG HIỆU:
     + Chữ in trên thân chai/nhãn dán là căn cứ quan trọng nhất để xác định hãng (ví dụ: "Calvin Klein", "Hugo Boss", "Chanel", "Dior", "Gucci", "Versace", "YSL", "Tom Ford", "Dolce & Gabbana", "Verites", v.v.).
     + Phân biệt rõ: Nếu trên chai ghi "ETERNITY - Calvin Klein", đó là nước hoa của Calvin Klein. Nếu trên chai ghi "HUGO BOSS" hoặc "BOSS", đó là nước hoa của Hugo Boss.
2. XÁC ĐỊNH SẢN PHẨM & TƯ VẤN HƯƠNG THƠM:
   - Nêu rõ: Tên chai nước hoa nhận diện được, Hãng sản xuất, Nồng độ và xuất xứ.
   - Nhận xét ngắn gọn về đặc trưng mùi hương, nốt hương chính (Hương đầu, Hương giữa, Hương cuối), phong cách và độ lưu hương.
3. ĐỐI CHIẾU DANH MỤC CỬA HÀNG L'ESSENCE:
   - Tra cứu trong danh mục cửa hàng L'essence bên dưới để tìm sản phẩm khớp chính xác với chai nước hoa bạn nhận diện được.
   - BẮT BUỘC chèn đúng thẻ [CARD:id_sản_phẩm] tương ứng của sản phẩm đó trong danh mục bên dưới (ví dụ: [CARD:id]) để hiển thị đúng thẻ sản phẩm cho khách hàng. Tuyệt đối KHÔNG gắn nhầm ID của sản phẩm khác!
   - Báo giá ưu đãi chính xác kèm mời khách hàng bấm xem chi tiết hoặc thêm vào giỏ hàng.

QUY TẮC ĐỊNH DẠNG & THÊM VÀO GIỎ HÀNG:
- Trả lời thân thiện, lịch sự, dùng icon :3.
- In đậm **Tên Sản Phẩm** và **Thương Hiệu**.
- BẮT BUỘC chèn [CARD:id_sản_phẩm] của sản phẩm khớp nhất từ danh mục để khách xem thông tin.
- TUYỆT ĐỐI KHÔNG chèn cú pháp [ADD_TO_CART:id_sản_phẩm] khi người dùng chỉ hỏi tên, nhận diện ảnh, hỏi giá hoặc nhờ tư vấn.
- CHỈ ĐƯỢC chèn cú pháp [ADD_TO_CART:id_sản_phẩm] khi và chỉ khi người dùng NÓI RÕ RÀNG RẰNG họ muốn mua hoặc thêm vào giỏ hàng (ví dụ: "thêm vào giỏ hàng cho tôi", "tôi muốn mua chai này", "cho vào giỏ hàng").
${storeCatalogContext}`;

  const fb = await AIService.createChatStream(messages, visionSystemPrompt, image);
  if (!fb.body) throw new Error('No body from AI');

  return reply
    .header('Content-Type', 'text/plain; charset=utf-8')
    .header('Cache-Control', 'no-cache, no-transform')
    .header('X-Accel-Buffering', 'no')
    .send(Readable.fromWeb(fb.body as any));
}
