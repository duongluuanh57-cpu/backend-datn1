/**
 * Route Executors — thực thi từng route
 * 
 * Mỗi executor nhận input và trả về kết quả dạng text hoặc stream
 */
import { AIService } from '../AIService.ts';
import { SearchService } from '../SearchService.ts';
import { ContentSearchService } from '../ContentSearchService.ts';
import { Brand } from '../../models/Brand.ts';
import { Tag } from '../../models/Tag.ts';
import { Product } from '../../models/Product.ts';
import type { RouteContext } from './queryRouterTypes.ts';
import { getTenantIds } from '../../utils/tenantHelper.ts';

// ── HELPERS ──────────────────────────────────────────────────────────────

/** Build context từ search results */
async function buildContext(
  message: string,
  tenantId: string,
  userRole?: string
): Promise<RouteContext> {
  let products: any[] = [];
  let mode: string = '';
  let documents: any[] = [];

  try {
    const [searchResult, contentResult] = await Promise.all([
      SearchService.hybridSearch(message, tenantId, 4),
      ContentSearchService.search(message, tenantId, 3).catch(() => []),
    ]);
    products = searchResult.products;
    mode = searchResult.mode;
    documents = contentResult;
  } catch (err) {
    console.error('❌ [RouteExecutors] Search Error:', err);
  }

  let storeOverview = '';
  try {
    const tenantIds = getTenantIds(tenantId);
    const [allBrands, allTags, productCount] = await Promise.all([
      Brand.find({ tenantId: { $in: tenantIds }, status: 'active' }).select('name').lean(),
      Tag.find({ tenantId: { $in: tenantIds }, status: 'active' }).select('name').lean(),
      Product.countDocuments({ tenantId: { $in: tenantIds } }),
    ]);
    storeOverview = `TỔNG QUAN CỬA HÀNG:
- Thương hiệu: ${allBrands.map((b: any) => b.name).join(', ')}
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
  const basePrompt = `Bạn là Tinco - Trợ lý AI bán nước hoa cao cấp.
Trả lời ngắn gọn, thân thiện, dùng icon :3.
KHÔNG bao giờ nhắc đến từ "Database", "Cơ sở dữ liệu", "Hệ thống"`;

  const isAdmin = userRole === 'ADMIN' || userRole === 'SUBADMIN';

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
      contextStr = `TRẠNG THÁI: Không tìm thấy sản phẩm cụ thể. Nhưng bạn CÓ thông tin tổng quan về cửa hàng. Dùng storeOverview để trả lời các câu hỏi chung (số lượng hãng, danh sách hãng...). Với câu hỏi về sản phẩm cụ thể thì xin lỗi lịch sự.`;
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
  tenantId: string,
  userRole?: string
): Promise<Response> {
  const ctx = await buildContext(message, tenantId, userRole);
  const systemPrompt = buildSystemPrompt(ctx, userRole);

  const messages = [
    { role: 'user' as const, content: message }
  ];

  return AIService.createChatStream(messages, systemPrompt);
}

/**
 * SQL/Keyword Search Executor
 * Tìm sản phẩm theo tên, hãng, giá bằng MongoDB → Gemini tổng hợp
 */
export async function executeSqlSearch(
  message: string,
  tenantId: string,
  userRole?: string
): Promise<Response> {
  const ctx = await buildContext(message, tenantId, userRole);
  const systemPrompt = buildSystemPrompt(ctx, userRole);

  const messages = [
    { role: 'user' as const, content: message }
  ];

  return AIService.createChatStream(messages, systemPrompt);
}

/**
 * Web Search Executor
 * Tra cứu thông tin từ web (xu hướng, tin tức bên ngoài)
 * Dùng Gemini để tạo câu trả lời dựa trên kiến thức có sẵn + context
 */
export async function executeWebSearch(
  message: string,
  tenantId: string,
  userRole?: string
): Promise<Response> {
  const systemPrompt = `Bạn là Tinco - Trợ lý AI bán nước hoa cao cấp.
Trả lời ngắn gọn, thân thiện, dùng icon :3.

User đang hỏi về các thông tin bên ngoài như xu hướng, tin tức, review nước hoa.
Hãy trả lời dựa trên kiến thức bạn có.
Nếu không chắc chắn, hãy nói "Mình sẽ cập nhật thêm thông tin này, bạn quay lại sau nhé! 😊"
KHÔNG bịa đặt thông tin hay số liệu cụ thể nếu không chắc chắn.`;

  const messages = [
    { role: 'user' as const, content: message }
  ];

  return AIService.createChatStream(messages, systemPrompt);
}

/**
 * Graph Search Executor
 * Gợi ý sản phẩm liên quan dựa trên brand, category, bought-together patterns
 */
export async function executeGraphSearch(
  message: string,
  tenantId: string,
  userRole?: string
): Promise<Response> {
  const ctx = await buildContext(message, tenantId, userRole);

  // Thêm context về related products nếu có sản phẩm
  let graphContext = '';
  if (ctx.products.length > 0) {
    try {
      // Tìm sản phẩm cùng brand hoặc cùng category để gợi ý
      const productIds = ctx.products.map(p => p._id);
      const brands = [...new Set(ctx.products.map(p => p.brandId).filter(Boolean))];
      
      const tenantIds = getTenantIds(tenantId);
      const relatedProducts = await Product.find({
        tenantId: { $in: tenantIds },
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
          return `- ${p.name}${brandName ? ` (${brandName})` : ''}`;
        }).join('\n')}`;
      }
    } catch (err) {
      console.error('❌ [GraphSearch] Error:', err);
    }
  }

  const systemPrompt = `Bạn là Tinco - Trợ lý AI bán nước hoa cao cấp.
Trả lời ngắn gọn, thân thiện, dùng icon :3.

Bạn đang ở chế độ GỢI Ý. Hãy tư vấn nhiệt tình, đề xuất sản phẩm phù hợp dựa trên nhu cầu của khách.
${ctx.products.length > 0 ? `SẢN PHẨM KHỚP:\n${ctx.products.map(p => `- ${p.name} (Hãng: ${p.brand}): [CARD:${p._id}]`).join('\n')}` : ''}
${graphContext ? `\n${graphContext}` : ''}

Hãy hỏi thêm sở thích của khách để gợi ý chính xác hơn!`;

  const messages = [
    { role: 'user' as const, content: message }
  ];

  return AIService.createChatStream(messages, systemPrompt);
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
  tenantId: string,
  userRole?: string
): Promise<{ text?: string; stream?: Response }> {
  // Check role
  if (userRole !== 'ADMIN' && userRole !== 'SUBADMIN') {
    return { text: roleDeniedResponse() };
  }

  // ── Gọi AdminAgent với function calling ──
  const { process: adminProcess } = await import('../agent/adminAgent.ts');
  const agentResult = await adminProcess(message, history, tenantId);

  return { text: agentResult.content };
}
