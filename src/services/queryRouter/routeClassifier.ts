/**
 * Route Classifier — Phân loại câu hỏi của user vào 1 trong 4 route
 *
 * Chiến lược:
 * 1. Fast path: rule-based cho greeting/confusion/gibberish
 * 2. LLM-based: dùng Gemini để classify cho các route còn lại (vector, sql, web, graph)
 * 3. Kết hợp với kết quả từ SearchService.hybridSearch() để tăng độ chính xác
 */
import { SearchService } from '../SearchService.ts';
import { normalize } from '../../utils/textNormalizer.ts';
import type { RouteType, RouteClassification, RouteInput } from './queryRouterTypes.ts';

// ── PATTERNS ──────────────────────────────────────────────────────────────
// Patterns không dấu vì được test trên normalize(message)
const greetingPatterns = [
  /^(xin )?chao/i, /^hi+$/i, /^hello+$/i, /^hey+$/i,
  /^good (morning|afternoon|evening)/i,
  /^(chuc )?buoi (sang|chieu|toi)/i,
  /^(ban|minh) (co )?khoe/i,
  /^(co ai|ai do) (o day|khong)/i,
  /^(cam on|thanks|thank you)/i,
  /^tam biet|bye|goodbye/i,
];

const confusionPatterns = [
  /^ua+$/i, /^ha+$/i, /^gi(\s+vay)?$/i,
  /^sao(\s+co)?$/i, /^y(\s+la)?(\s+sao)?$/i,
  /^cai(\s+gi)?$/i, /^dau(\s+co)?$/i,
  /^tai(\s+sao)?$/i, /^la(\s+sao)?$/i,
  /^o(\s+kia)?$/i, /^a(\s+la)?$/i,
];

/** Check greeting fast path */
function isGreeting(text: string): boolean {
  return greetingPatterns.some(p => p.test(text));
}

/** Check confusion fast path */
function isConfusion(text: string): boolean {
  return confusionPatterns.some(p => p.test(text));
}

/** Check gibberish fast path */
function isGibberish(text: string): boolean {
  const cleanQuery = normalize(text);
  const vowelRatio = (cleanQuery.match(/[aeiouáàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ]/gi) || []).length / cleanQuery.length;
  const maxRepeat = Math.max(...(cleanQuery.match(/(.)\1+/g) || []).map(s => s.length));
  return vowelRatio < 0.15 || maxRepeat >= 5 || /^[^aeiouy]{5,}$/i.test(cleanQuery.split(/\s+/).filter(Boolean).join(''));
}

/**
 * LLM-based route classification using Gemini Function Calling (Interactions API)
 * 
 * Thay thế cách cũ (prompt text + parse JSON) bằng tool call chính xác hơn.
 * Gemini buộc phải gọi tool `classifyQuery` → trả về route + confidence.
 */
async function llmRouteClassify(
  message: string,
  searchMode: string,
  userRole: string | undefined
): Promise<RouteClassification> {
  const isAdmin = userRole === 'ADMIN';
  const validRoutes: RouteType[] = [
    'greeting', 'confusion', 'gibberish',
    'vector_search', 'sql_search', 'web_search', 'graph_search',
    'admin_query',
  ];

  try {
    const { generateText } = await import('ai');
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
    const { z } = await import('zod');

    const provider = createGoogleGenerativeAI({
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    });

    // Lưu runtime vars cho scope
    const _message = message;
    const _searchMode = searchMode;
    const _isAdmin = isAdmin;

    // Dùng any cast vì type ToolSet của AI SDK v6 quá phức tạp
    // Runtime vẫn chạy đúng nhờ --strip-types
    const result = await (generateText as any)({
      model: provider.interactions('gemini-3.1-flash-lite-preview'),
      system: `Bạn là router AI. Nhiệm vụ: phân loại câu hỏi của user vào ĐÚNG 1 route.

QUY TẮC:
- Tạo/thêm/sửa/xóa sản phẩm, bật/ẩn brand, quản lý sản phẩm → admin_query
- Thống kê, báo cáo, doanh thu, đơn hàng → admin_query
- Mùi hương/cảm xúc/mô tả → vector_search
- Tên/hãng/giá/thông tin cụ thể → sql_search
- Tin tức/xu hướng bên ngoài → web_search
- Gợi ý/khuyên dùng/tương tự → graph_search
- Chào hỏi, cảm ơn, tạm biệt → greeting
- Bối rối, không hiểu → confusion
- Vô nghĩa → gibberish

SEARCH MODE HIỆN TẠI: "${_searchMode}"
${_isAdmin ? 'User là ADMIN. ƯU TIÊN admin_query cho mọi yêu cầu liên quan đến tạo/sửa/xóa/thống kê.' : 'User là khách — KHÔNG dùng admin_query.'}`,
      messages: [{ role: 'user', content: _message }],
      tools: {
        classifyQuery: {
          description: 'Phân loại câu hỏi của user vào 1 route duy nhất',
          parameters: z.object({
            route: z.enum([
              'vector_search', 'sql_search', 'web_search', 'graph_search',
              'admin_query', 'greeting', 'confusion', 'gibberish'
            ] as const).describe('Route phù hợp nhất'),
            confidence: z.number().min(0).max(1).describe('Độ tin cậy (0.0-1.0)'),
          }),
          execute: async ({ route, confidence }: { route: string; confidence: number }) => {
            return { route, confidence };
          },
        },
      },
      toolChoice: { type: 'tool', toolName: 'classifyQuery' },
    });

    // Lấy kết quả từ tool call
    const toolCalls = result.toolCalls;
    if (toolCalls && toolCalls.length > 0) {
      const call = toolCalls[0];
      const input = call.input as { route: string; confidence: number };
      const route = input.route as RouteType;
      const confidence = input.confidence || 0.5;

      if (validRoutes.includes(route)) {
        return {
          route,
          confidence,
          requiresAdmin: route === 'admin_query',
        };
      }
    }

    // Fallback
    return { route: 'vector_search', confidence: 0.5 };
  } catch (error: any) {
    console.error('❌ [llmRouteClassify Error]:', error?.message || error);
    return { route: 'vector_search', confidence: 0.5 };
  }
}

/**
 * Main classify function
 */
export async function classifyRoute(input: RouteInput): Promise<RouteClassification> {
  const { message, userRole } = input;
  const cleanText = normalize(message);

  // ── Fast path 1: Greeting ──
  if (isGreeting(cleanText)) {
    return { route: 'greeting', confidence: 1.0 };
  }

  // ── Fast path 2: Confusion ──
  if (isConfusion(cleanText)) {
    return { route: 'confusion', confidence: 1.0 };
  }

  // ── Fast path 3: Gibberish ──
  if (isGibberish(cleanText)) {
    return { route: 'gibberish', confidence: 1.0 };
  }

  // ── Fast path 4: Admin intent keywords ──
  // Nếu user là ADMIN và message chứa từ khóa quản trị → admin_query ngay
  if (userRole === 'ADMIN') {
    const adminKeywords = /tao|them|xoa|sua|cap nhat|doi|thong ke|bao cao|doanh thu|don hang|brand|hang\s+\w+|san pham\s+moi|quan ly|san pham|product|danh muc|category|tag|nguoi dung|user|voucher|ma giam gia|bao nhieu|may|co may|liet ke|danh sach|ke ten|dem|tong|thuong hieu/i;
    if (adminKeywords.test(cleanText)) {
      console.log(`🔀 [QueryRouter] Admin keyword detected → admin_query (rule-based)`);
      return { route: 'admin_query', confidence: 1.0, requiresAdmin: true };
    }
  }

  // ── Fast path 5: Khách hàng storefront trên trang chủ ──
  // Đối với người dùng thông thường, mọi câu hỏi tư vấn/tìm kiếm đều dùng vector_search.
  // Không cần gọi thêm 1 lượt LLM classification tốn 2-4 giây!
  if (userRole !== 'ADMIN') {
    return { route: 'vector_search', confidence: 0.95 };
  }

  // ── LLM-based classification (chỉ dành cho ADMIN khi không rõ ý định) ──
  const search = await SearchService.hybridSearch(message, 1);
  const searchMode = search.mode;

  return llmRouteClassify(message, searchMode, userRole);
}