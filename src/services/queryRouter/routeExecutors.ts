/**
 * Route Executors — thực thi từng route
 * 
 * Mỗi executor nhận input và trả về kết quả dạng text hoặc stream
 */
import { AIService } from '../AIService.ts';
import { SearchService, extractPriceRange } from '../SearchService.ts';
import { formatMultipleProducts } from '../product/productFormatterService.ts';
import { Brand } from '../../models/Brand.ts';
import { Tag } from '../../models/Tag.ts';
import { Product } from '../../models/Product.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import type { RouteContext } from './queryRouterTypes.ts';

// ── HELPERS ──────────────────────────────────────────────────────────────

/** Lịch sử đưa vào prompt phải sạch token điều khiển UI và giới hạn số turn để tránh blow-up token / spoof card */
function sanitizeHistory(history: any[]): { role: 'user' | 'assistant'; content: string }[] {
  return (history || [])
    .slice(-10)
    .map(h => ({
      role: (h?.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: String(h?.content || '').replace(/\[(?:CARD|BUY_FLOW|ADD_TO_CART):\s*[^\]]*\]/gi, '').trim(),
    }))
    .filter(h => h.content.length > 0);
}

/** Câu hỏi hiện tại LUÔN là turn role 'user' */
function buildChatMessages(history: any[], message: string) {
  const chatMessages = sanitizeHistory(history);
  const last = chatMessages[chatMessages.length - 1];
  if (last && last.role === 'user') {
    chatMessages[chatMessages.length - 1] = { role: 'user' as const, content: message };
  } else {
    chatMessages.push({ role: 'user' as const, content: message });
  }
  return chatMessages;
}

let cachedStoreOverview: { data: string; expiresAt: number } | null = null;

async function getStoreOverview(): Promise<string> {
  const now = Date.now();
  if (cachedStoreOverview && now < cachedStoreOverview.expiresAt) {
    return cachedStoreOverview.data;
  }
  try {
    const [allBrands, allTags, productCount] = await Promise.all([
      Brand.find({ status: 'active' }).select('name origin').lean(),
      Tag.find({ status: 'active' }).select('name').lean(),
      Product.countDocuments({ status: 'active' }),
    ]);
    const overview = `TỔNG QUAN CỬA HÀNG:
- Danh sách thương hiệu và xuất xứ hiện có trong shop:
${allBrands.map((b: any) => `  + ${b.name}${b.origin ? ` (Xuất xứ: ${b.origin})` : ''}`).join('\n')}
- Tags: ${allTags.map((t: any) => t.name).join(', ')}
- Tổng số sản phẩm: ${productCount}`;
    cachedStoreOverview = { data: overview, expiresAt: now + 300_000 };
    return overview;
  } catch (dbErr) {
    console.error('Error fetching store overview:', dbErr);
    return cachedStoreOverview?.data || '';
  }
}

/** Build context từ search results */
async function buildContext(
  message: string,
  history: any[] = [],
  userRole?: string
): Promise<RouteContext> {
  let products: any[] = [];
  let mode: string = '';
  let storeOverview: string = '';

  try {
    const [searchResult, overview] = await Promise.all([
      SearchService.hybridSearch(message, 4),
      getStoreOverview(),
    ]);

    storeOverview = overview;
    mode = searchResult.mode;

    const rawProducts = searchResult.products || [];
    if (rawProducts.length > 0) {
      products = await formatMultipleProducts(rawProducts);

      // Lọc theo giá HIỂN THỊ trên card (price của formatted product) để không đề xuất sp vượt khoảng giá khách yêu cầu
      const priceRange = extractPriceRange(message);
      if (priceRange) {
        const { minPrice, maxPrice } = priceRange;
        products = products.filter((p: any) => {
          const pVal = p.price;
          if (typeof pVal !== 'number' || pVal <= 0) return false;
          if (minPrice !== undefined && pVal < minPrice) return false;
          if (maxPrice !== undefined && pVal > maxPrice) return false;
          return true;
        });
      }
    }

    // Nếu search theo nội dung câu ngắn (như "thêm sản phẩm vào giỏ hàng") không khớp sản phẩm,
    // hãy trích xuất sản phẩm từ các card trong tin nhắn gần nhất của lịch sử trò chuyện
    if (products.length === 0 && history && history.length > 0) {
      const recentCardIds: string[] = [];
      for (let i = history.length - 1; i >= Math.max(0, history.length - 4); i--) {
        const itemContent = String(history[i]?.content || '');
        const matches = Array.from(itemContent.matchAll(/\[CARD:\s*([a-f\d]{24})\s*\]/gi));
        for (const m of matches) {
          if (m[1] && !recentCardIds.includes(m[1])) {
            recentCardIds.push(m[1]);
          }
        }
      }

      if (recentCardIds.length > 0) {
        const fallbackDocs = await Product.find({ _id: { $in: recentCardIds }, status: 'active' })
          .populate('brandId')
          .populate('categoryId')
          .lean();
        if (fallbackDocs.length > 0) {
          products = await formatMultipleProducts(fallbackDocs);
        }
      }
    }
  } catch (err) {
    console.error('❌ [RouteExecutors] Search Error:', err);
  }

  return {
    products,
    mode,
    storeOverview,
    historyContext: '',
    adaptiveDirective: '',
  };
}

/** Build AI system prompt từ context */
function buildSystemPrompt(
  ctx: RouteContext,
  userRole?: string
): string {
  const basePrompt = `Bạn là Tinco - Trợ lý AI bán nước hoa cao cấp của cửa hàng L'essence.
Trả lời ngắn gọn, thân thiện, dùng icon :3.
KHÔNG bao giờ nhắc đến từ "Database", "Cơ sở dữ liệu", "Hệ thống".

PHẠM VI HOẠT ĐỘNG:
- Chỉ tư vấn sản phẩm nước hoa, thương hiệu, mùi hương, giá và dung tích.
- Hỗ trợ khách chọn loại sản phẩm và thêm sản phẩm vào giỏ hàng.
- Không trả lời tin tức, tài liệu, chính sách hoặc câu hỏi ngoài phạm vi sản phẩm; nếu ngoài phạm vi, hãy nhờ khách liên hệ bộ phận phù hợp.

QUY TẮC HIỂN THỊ CARD SẢN PHẨM: Khi đề xuất, giới thiệu hoặc nhắc đến bất kỳ sản phẩm nào có trong danh sách, bạn BẮT BUỘC phải chèn định dạng [CARD:id_sản_phẩm] ngay sau tên sản phẩm (ví dụ: Paco Rabanne Million Gold [CARD:123]) để giao diện hiển thị khung sản phẩm cho khách hàng.

QUY TẮC MUA HÀNG & CHỌN LOẠI SẢN PHẨM: Khi người dùng nói muốn mua, đặt mua, lấy hàng, hoặc thêm vào giỏ hàng một sản phẩm nào đó (ví dụ "tôi muốn mua sản phẩm này", "tôi muốn mua chai này", "thêm vào giỏ hàng chai Chloe", "đặt mua chai Boss", "lấy chai 1", "cho vào giỏ hàng", v.v.):
- BẮT BUỘC chèn cú pháp [BUY_FLOW:id_sản_phẩm] và [CARD:id_sản_phẩm] vào câu trả lời.
- Bạn PHẢI hỏi trước khách hàng muốn chọn loại sản phẩm như thế nào: "Dạ bạn muốn chọn loại sản phẩm nào cho chai **[Tên sản phẩm]** ạ? :3 Cửa hàng mình có sẵn bản **Chiết chai** (nhỏ gọn, tiện lợi) và bản **Fullbox** (nguyên seal chính hãng cao cấp). Bạn bấm chọn ở nút bên dưới giúp mình nhé! [BUY_FLOW:id_sản_phẩm] [CARD:id_sản_phẩm]".
- TUYỆT ĐỐI KHÔNG tự ý thêm bừa vào giỏ hàng với dung tích mặc định, vì khách hàng cần bấm chọn Loại (Chiết / Fullbox) và Dung tích mong muốn trên nút bấm trước!

QUY TẮC ĐỊNH DẠNG TIN NHẮN:
- Khi nhắc đến hoặc giới thiệu sản phẩm/thương hiệu, hãy in đậm tên bằng cú pháp **Tên Sản Phẩm** (ví dụ: **YSL MYSLF**, **Chanel Bleu**).
- Trình bày dạng danh sách gạch đầu dòng gọn gàng kèm giá bán cụ thể (ví dụ: - **Tên sản phẩm** (Hãng) - Giá: 1.225.000đ: Mô tả ngắn...). Tuyệt đối KHÔNG viết dấu hoa thị dính chùm như *** hay * **.
- QUAN TRỌNG VỀ GIÁ GIẢM: Nếu sản phẩm có giá khuyến mãi/giảm giá (trong context có ghi "Giá gốc:" và "Giảm: %"), bạn BẮT BUỘC phải tư vấn giá bán đã giảm (giá ưu đãi/khuyến mãi) cho khách hàng (ví dụ: "Giá ưu đãi chỉ: 1.225.000đ (giá gốc: 2.450.000đ, giảm 50%)"). Tuyệt đối KHÔNG báo giá gốc như là giá bán hiện tại!

QUY TẮC TRA CỨU THƯƠNG HIỆU & XUẤT XỨ: Khi người dùng hỏi về thương hiệu hoặc các hãng theo xuất xứ quốc gia (như "hãng nước hoa Việt Nam", "nước hoa Pháp", "hãng của Ý", "hãng Mỹ", "hãng Anh", v.v.), bạn BẮT BUỘC phải tra cứu phần "TỔNG QUAN CỬA HÀNG" bên dưới. Nếu cửa hàng có thương hiệu thuộc quốc gia đó (ví dụ: Verites có xuất xứ Việt Nam), bạn PHẢI giới thiệu ngay cho khách hàng. KHÔNG ĐƯỢC trả lời là shop chỉ có hãng quốc tế khi cửa hàng có thương hiệu đó!`;

  const isAdmin = userRole === 'ADMIN';

  // Build context string
  let contextStr = '';
  if (ctx.mode === 'confusion') {
    contextStr = `TRẠNG THÁI: Người dùng tỏ ra bối rối/không hiểu. Hãy hỏi lại nhẹ nhàng, KIÊN NHẪN, KHÔNG đề xuất sản phẩm. Hỏi "Mình có thể giúp gì cho bạn không ạ?" hoặc "Bạn muốn tìm mùi hương như thế nào?".`;
  } else if (ctx.mode === 'greeting') {
    contextStr = `TRẠNG THÁI: Khách vừa chào. Chỉ chào lại thân thiện, KHÔNG đề xuất sản phẩm.`;
  } else if (ctx.mode === 'gibberish') {
    contextStr = `TRẠNG THÁI: Người dùng nhập nội dung không rõ ràng. Hãy lịch sự hỏi lại họ cần tìm gì, KHÔNG đề xuất sản phẩm cụ thể.`;
  } else if (ctx.products.length === 0) {
    if (ctx.storeOverview) {
      contextStr = `TRẠNG THÁI: Chưa tìm thấy sản phẩm cụ thể đang mở bán. Nhưng bạn CÓ danh sách thương hiệu và xuất xứ trong storeOverview. Dùng storeOverview để trả lời các câu hỏi về hãng, xuất xứ (ví dụ hãng Việt Nam, Pháp, Ý...). Nếu khách hỏi sản phẩm cụ thể mà chưa có thì báo là hiện tại chưa có sản phẩm cụ thể của hãng đó lên kệ.`;
    } else {
      contextStr = `TRẠNG THÁI: Không tìm thấy sản phẩm phù hợp. Xin lỗi lịch sự. KHÔNG đề xuất sản phẩm.`;
    }
  } else {
    contextStr = `DANH SÁCH SẢN PHẨM KHỚP NHẤT:\n${ctx.products.map(p => {
      const priceStr = p.price ? `${p.price.toLocaleString('vi-VN')}đ` : 'Liên hệ';
      const origPriceStr = p.originalPrice && p.originalPrice > p.price ? ` (Giá gốc: ${p.originalPrice.toLocaleString('vi-VN')}đ, Giảm: ${p.discount}%)` : '';
      const descStr = p.description ? ` | Mô tả: ${p.description.substring(0, 100)}` : '';
      const catStr = p.category?.name ? ` | Danh mục: ${p.category.name}` : '';
      const sizeStr = p.size ? ` | Dung tích: ${p.size}` : '';
      return `- **${p.name}** (Hãng: ${p.brand} | Giá bán: ${priceStr}${origPriceStr}${catStr}${sizeStr}${descStr}) [CARD:${p._id}]`;
    }).join('\n')}`;
  }

  if (ctx.storeOverview) {
    contextStr += `\n\n${ctx.storeOverview}`;
  }

  if (isAdmin) {
    contextStr += `\n\nLƯU Ý: Người đang chat là quản trị viên (admin). Xưng "em" và gọi họ là "sếp" hoặc "anh/chị". Nói chuyện lịch sự, chuyên nghiệp như nhân viên báo cáo sếp.`;
  }

  return `${basePrompt}\n\n${contextStr}`;
}

// ── RESPONSES ─────────────────────────────────────────────────────────────

/** Role denied response (used in admin executor) */
function roleDeniedResponse(): string {
  return "Xin lỗi, bạn không có quyền truy cập vào thông tin này. Tính năng này chỉ dành cho quản trị viên. Nếu bạn cần hỗ trợ, hãy liên hệ với đội ngũ quản trị.";
}

// ── EXECUTORS ─────────────────────────────────────────────────────────────

/**
 * Vector Search Executor
 * Tìm sản phẩm theo mùi hương, cảm xúc bằng vector search → Gemini tổng hợp
 */
export async function executeVectorSearch(
  message: string,
  history: any[],
  userRole?: string
): Promise<{ stream: Response; products: any[] }> {
  const ctx = await buildContext(message, history, userRole);
  const systemPrompt = buildSystemPrompt(ctx, userRole);

  const chatMessages = buildChatMessages(history, message);

  const stream = await AIService.createChatStream(chatMessages, systemPrompt);
  return { stream, products: ctx.products || [] };
}

/**
 * SQL/Keyword Search Executor
 * Tìm sản phẩm theo tên, hãng, giá bằng MongoDB → Gemini tổng hợp
 */
export async function executeSqlSearch(
  message: string,
  history: any[],
  userRole?: string
): Promise<{ stream: Response; products: any[] }> {
  const ctx = await buildContext(message, history, userRole);
  const systemPrompt = buildSystemPrompt(ctx, userRole);

  const chatMessages = buildChatMessages(history, message);

  const stream = await AIService.createChatStream(chatMessages, systemPrompt);
  return { stream, products: ctx.products || [] };
}

/**
 * Web Search Executor
 * Tra cứu thông tin từ web (xu hướng, tin tức bên ngoài)
 * Dùng Gemini để tạo câu trả lời dựa trên kiến thức có sẵn + context
 */
export async function executeWebSearch(
  message: string,
  history: any[],
  userRole?: string
): Promise<{ stream: Response; products: any[] }> {
  const systemPrompt = `Bạn là Tinco - Trợ lý AI bán nước hoa cao cấp.
Trả lời ngắn gọn, thân thiện, dùng icon :3.

User đang hỏi về các thông tin bên ngoài như xu hướng, tin tức, review nước hoa.
Hãy trả lời dựa trên kiến thức bạn có.
Nếu không chắc chắn, hãy nói "Mình sẽ cập nhật thêm thông tin này, bạn quay lại sau nhé! 😊"
KHÔNG bịa đặt thông tin hay số liệu cụ thể nếu không chắc chắn.`;

  const chatMessages = buildChatMessages(history, message);

  const stream = await AIService.createChatStream(chatMessages, systemPrompt);
  return { stream, products: [] };
}

/**
 * Graph Search Executor
 * Gợi ý sản phẩm liên quan dựa trên brand, category, bought-together patterns
 */
export async function executeGraphSearch(
  message: string,
  history: any[],
  userRole?: string
): Promise<{ stream: Response; products: any[] }> {
  const ctx = await buildContext(message, history, userRole);

  // Thêm context về related products nếu có sản phẩm
  let graphContext = '';
  if (ctx.products.length > 0) {
    try {
      const productIds = ctx.products.map(p => p._id);
      const brands = [...new Set(ctx.products.map(p => p.brandId).filter(Boolean))];
      
      const relatedDocs = await Product.find({
        _id: { $nin: productIds },
        $or: [
          { brandId: { $in: brands } },
        ],
        status: 'active',
      })
        .select('name brandId images')
        .limit(10)
        .populate('brandId', 'name')
        .lean();

      // Chỉ gợi ý sản phẩm liên quan còn hàng
      const relatedInStockIds = relatedDocs.length > 0
        ? await ProductVariant.distinct('productId', {
            productId: { $in: relatedDocs.map((p: any) => p._id) },
            quantityInStock: { $gt: 0 },
          })
        : [];
      const relatedInStockSet = new Set(relatedInStockIds.map((id: any) => id.toString()));
      const relatedProducts = relatedDocs
        .filter((p: any) => relatedInStockSet.has(p._id.toString()))
        .slice(0, 5);

      if (relatedProducts.length > 0) {
        graphContext = `SẢN PHẨM LIÊN QUAN (cùng hãng):\n${relatedProducts.map((p: any) => {
          const brandName = p.brandId?.name || '';
          return `- ${p.name}${brandName ? ` (${brandName})` : ''}: [CARD:${p._id}]`;
        }).join('\n')}`;
      }
    } catch (err) {
      console.error('❌ [GraphSearch] Error:', err);
    }
  }

  const systemPrompt = `Bạn là Tinco - Trợ lý AI bán nước hoa cao cấp.
Trả lời ngắn gọn, thân thiện, dùng icon :3.

Bạn đang ở chế độ GỢI Ý. Hãy tư vấn nhiệt tình, đề xuất sản phẩm phù hợp dựa trên nhu cầu của khách.
QUY TẮC HIỂN THỊ CARD SẢN PHẨM: Khi đề xuất, giới thiệu hoặc nhắc đến bất kỳ sản phẩm nào có trong danh sách, bạn BẮT BUỘC phải chèn định dạng [CARD:id_sản_phẩm] ngay sau tên sản phẩm (ví dụ: Paco Rabanne Million Gold [CARD:123]).
QUY TẮC MUA HÀNG & THÊM VÀO GIỎ: Khi người dùng nói muốn mua, đặt mua, lấy hàng, hoặc thêm vào giỏ hàng một sản phẩm nào đó, bạn KHÔNG được tuyên bố đã thực hiện bất kỳ thao tác nào (tuyệt đối KHÔNG nói "đã thêm vào giỏ hàng"). Bạn PHẢI hỏi trước khách muốn chọn loại sản phẩm (Chiết chai / Fullbox) và dung tích, đồng thời BẮT BUỘC chèn cú pháp [BUY_FLOW:id_sản_phẩm] và [CARD:id_sản_phẩm] vào câu trả lời để khách bấm chọn ở nút bên dưới.

${ctx.products.length > 0 ? `SẢN PHẨM KHỚP:\n${ctx.products.map(p => {
  const priceStr = p.price ? `${p.price.toLocaleString('vi-VN')}đ` : 'Liên hệ';
  const origPriceStr = p.originalPrice && p.originalPrice > p.price ? ` (Giá gốc: ${p.originalPrice.toLocaleString('vi-VN')}đ, Giảm: ${p.discount}%)` : '';
  return `- **${p.name}** (Hãng: ${p.brand} | Giá bán: ${priceStr}${origPriceStr}): [CARD:${p._id}]`;
}).join('\n')}` : ''}
${graphContext ? `\n${graphContext}` : ''}

Hãy hỏi thêm sở thích của khách để gợi ý chính xác hơn!`;

  const chatMessages = buildChatMessages(history, message);

  const stream = await AIService.createChatStream(chatMessages, systemPrompt);
  return { stream, products: ctx.products || [] };
}

/**
 * Admin Query Executor
 * Xử lý câu hỏi quản trị bằng AdminAgent (Gemini function calling)
 * 
 * AdminAgent hỗ trợ:
 * - Tạo/sửa/xóa sản phẩm qua chat
 * - Tìm kiếm sản phẩm
 * - Trả lời các câu hỏi quản trị khác bằng text
 */
export async function executeAdminQuery(
  message: string,
  history: any[],
  userRole?: string
): Promise<{ text?: string; stream?: Response }> {
  // Check role
  if (userRole !== 'ADMIN') {
    return { text: roleDeniedResponse() };
  }

  // ── Gọi AdminAgent với function calling ──
  const { process: adminProcess } = await import('../agent/adminAgent.ts');
  const agentResult = await adminProcess(message, history);

  return { text: agentResult.content };
}
