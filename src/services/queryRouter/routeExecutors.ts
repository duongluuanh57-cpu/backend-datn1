/**
 * Route Executors — thực thi từng route
 * 
 * Mỗi executor nhận input và trả về kết quả dạng text hoặc stream
 */
import { AIService } from '../AIService.ts';
import { SearchService } from '../SearchService.ts';
import { ContentSearchService } from '../ContentSearchService.ts';
import { formatMultipleProducts } from '../product/productFormatterService.ts';
import { Brand } from '../../models/Brand.ts';
import { Tag } from '../../models/Tag.ts';
import { Product } from '../../models/Product.ts';
import type { RouteContext } from './queryRouterTypes.ts';

// ── HELPERS ──────────────────────────────────────────────────────────────

/** Build context từ search results */
async function buildContext(
  message: string,
  userRole?: string
): Promise<RouteContext> {
  let products: any[] = [];
  let mode: string = '';
  let documents: any[] = [];

  try {
    const [searchResult, contentResult] = await Promise.all([
      SearchService.hybridSearch(message, 4),
      ContentSearchService.search(message, 3).catch(() => []),
    ]);
    const rawProducts = searchResult.products || [];
    if (rawProducts.length > 0) {
      products = await formatMultipleProducts(rawProducts);
    } else {
      products = [];
    }
    mode = searchResult.mode;
    documents = contentResult;
  } catch (err) {
    console.error('❌ [RouteExecutors] Search Error:', err);
  }

  let storeOverview = '';
  try {
    const [allBrands, allTags, productCount] = await Promise.all([
      Brand.find({ status: 'active' }).select('name origin').lean(),
      Tag.find({ status: 'active' }).select('name').lean(),
      Product.countDocuments({ status: 'active' }),
    ]);
    storeOverview = `TỔNG QUAN CỬA HÀNG:
- Danh sách thương hiệu và xuất xứ hiện có trong shop:
${allBrands.map((b: any) => `  + ${b.name}${b.origin ? ` (Xuất xứ: ${b.origin})` : ''}`).join('\n')}
- Tags: ${allTags.map((t: any) => t.name).join(', ')}
- Tổng số sản phẩm: ${productCount}`;
  } catch (dbErr) {
    console.error('Error fetching store overview:', dbErr);
  }

  return {
    products,
    documents,
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

QUY TẮC HIỂN THỊ CARD SẢN PHẨM: Khi đề xuất, giới thiệu hoặc nhắc đến bất kỳ sản phẩm nào có trong danh sách, bạn BẮT BUỘC phải chèn định dạng [CARD:id_sản_phẩm] ngay sau tên sản phẩm (ví dụ: Paco Rabanne Million Gold [CARD:123]) để giao diện hiển thị khung sản phẩm cho khách hàng.

QUY TẮC ĐỊNH DẠNG TIN NHẮN:
- Khi nhắc đến hoặc giới thiệu sản phẩm/thương hiệu, hãy in đậm tên bằng cú pháp **Tên Sản Phẩm** (ví dụ: **YSL MYSLF**, **Chanel Bleu**).
- Trình bày dạng danh sách gạch đầu dòng gọn gàng (ví dụ: - **Tên sản phẩm**: Mô tả ngắn...). Tuyệt đối KHÔNG viết dấu hoa thị dính chùm như *** hay * **.

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
    contextStr = `DANH SÁCH SẢN PHẨM KHỚP NHẤT:\n${ctx.products.map(p => `- ${p.name} (Hãng: ${p.brand}): [CARD:${p._id}]`).join('\n')}`;
  }

  if (ctx.documents.length > 0) {
    contextStr += `\n\nTÀI LIỆU LIÊN QUAN:\n${ctx.documents.map(d => `- [${d.title}]: ${d.body.substring(0, 500)}`).join('\n')}`;
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
  const ctx = await buildContext(message, userRole);
  const systemPrompt = buildSystemPrompt(ctx, userRole);

  const chatMessages = [...history];
  if (chatMessages.length > 0) {
    chatMessages[chatMessages.length - 1] = {
      ...chatMessages[chatMessages.length - 1],
      content: message,
    };
  } else {
    chatMessages.push({ role: 'user' as const, content: message });
  }

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
  const ctx = await buildContext(message, userRole);
  const systemPrompt = buildSystemPrompt(ctx, userRole);

  const chatMessages = [...history];
  if (chatMessages.length > 0) {
    chatMessages[chatMessages.length - 1] = {
      ...chatMessages[chatMessages.length - 1],
      content: message,
    };
  } else {
    chatMessages.push({ role: 'user' as const, content: message });
  }

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

  const chatMessages = [...history];
  if (chatMessages.length > 0) {
    chatMessages[chatMessages.length - 1] = {
      ...chatMessages[chatMessages.length - 1],
      content: message,
    };
  } else {
    chatMessages.push({ role: 'user' as const, content: message });
  }

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
  const ctx = await buildContext(message, userRole);

  // Thêm context về related products nếu có sản phẩm
  let graphContext = '';
  if (ctx.products.length > 0) {
    try {
      const productIds = ctx.products.map(p => p._id);
      const brands = [...new Set(ctx.products.map(p => p.brandId).filter(Boolean))];
      
      const relatedProducts = await Product.find({
        _id: { $nin: productIds },
        $or: [
          { brandId: { $in: brands } },
        ],
        status: 'active',
      })
        .select('name price brandId images')
        .limit(5)
        .populate('brandId', 'name')
        .lean();

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

${ctx.products.length > 0 ? `SẢN PHẨM KHỚP:\n${ctx.products.map(p => `- ${p.name} (Hãng: ${p.brand}): [CARD:${p._id}]`).join('\n')}` : ''}
${graphContext ? `\n${graphContext}` : ''}

Hãy hỏi thêm sở thích của khách để gợi ý chính xác hơn!`;

  const chatMessages = [...history];
  if (chatMessages.length > 0) {
    chatMessages[chatMessages.length - 1] = {
      ...chatMessages[chatMessages.length - 1],
      content: message,
    };
  } else {
    chatMessages.push({ role: 'user' as const, content: message });
  }

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
