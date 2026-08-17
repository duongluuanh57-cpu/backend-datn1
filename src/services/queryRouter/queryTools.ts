/**
 * queryTools — Tool definitions cho Query Router dùng Gemini Function Calling
 *
 * Thay thế routeClassifier.ts + switch-case trong QueryRouterService
 * Bằng 1 lần gọi Gemini Interactions API với tools
 */
import { tool } from 'ai';
import { z } from 'zod';
import { SearchService } from '../SearchService.ts';
import { Product } from '../../models/Product.ts';

// ── Helpers ──

function toCardMarkdown(products: any[]): string {
  return products
    .map((p: any) => `- **${p.name}** (${p.brand}): ${p.price?.toLocaleString('vi-VN')}₫ [CARD:${p._id}]`)
    .join('\n');
}

// ── Shared context (set by QueryRouterService before calling Gemini) ──
let currentContext: { userRole?: string } = {};

export function setToolContext(ctx: { userRole?: string }) {
  currentContext = ctx;
}

// ── Tool Definitions ──
// Dùng tool() wrapper + cast để tránh lỗi overload type

export const queryToolsMap = {
  directReply: tool({
    description: `Trả lời trực tiếp các tình huống sau, KHÔNG cần tìm kiếm sản phẩm:
- Chào hỏi, cảm ơn, tạm biệt, hỏi thăm
- User bối rối, không hiểu (ủa? hả? gì? sao?)
- Nội dung vô nghĩa, ký tự lộn xộn
- Câu hỏi chung chung không liên quan sản phẩm`,
    parameters: z.object({
      answer: z.string().describe('Câu trả lời trực tiếp, ngắn gọn 1-2 câu, thân thiện, dùng icon. KHÔNG đề xuất sản phẩm.'),
    }),
    execute: (async ({ answer }: { answer: string }) => answer) as any,
  } as any),

  searchProducts: tool({
    description: `Tìm kiếm sản phẩm nước hoa theo:
- Mùi hương, cảm xúc, mô tả (vd: "nước hoa mùi ngọt ngào", "thơm như hoa hồng", "mùi gỗ ấm áp")
- Tên sản phẩm, tên hãng, xuất xứ quốc gia (vd: "Chanel No5", "nước hoa Dior", "hãng nước hoa Việt Nam", "nước hoa Pháp")
- Khoảng giá (vd: "dưới 1 triệu", "từ 2-5 triệu")
- Loại (vd: "nước hoa nam", "nước hoa nữ", "unisex")
Dùng cho HẦU HẾT câu hỏi về sản phẩm và thương hiệu của shop.`,
    parameters: z.object({
      query: z.string().describe('Câu hỏi gốc của người dùng về sản phẩm hoặc thương hiệu họ muốn tìm'),
    }),
    execute: (async ({ query }: { query: string }) => {
      const { userRole } = currentContext;
      const isAdmin = userRole === 'ADMIN';
      const search = await SearchService.hybridSearch(query, 4);
      const products = search.products || [];
      const brands = (search as any).brands || [];

      if (!products.length && !brands.length) {
        return 'Không tìm thấy sản phẩm hay thương hiệu phù hợp trong hệ thống shop. Hãy thông báo lịch sự cho khách.';
      }

      let result = '';
      if (brands.length > 0) {
        result += `THƯƠNG HIỆU PHÙ HỢP:\n${brands.map((b: any) => `- **${b.name}** (Xuất xứ: ${b.origin || 'Chưa cập nhật'})`).join('\n')}\n\n`;
      }
      if (products.length > 0) {
        result += `DANH SÁCH SẢN PHẨM KHỚP:\n${toCardMarkdown(products)}`;
      } else if (brands.length > 0) {
        result += `(Lưu ý: Shop có các thương hiệu trên trong hệ thống)`;
      }

      if (isAdmin) result += '\n\n(Lưu ý: User là ADMIN)';
      return result;
    }) as any,
  } as any),

  suggestProducts: tool({
    description: `Gợi ý sản phẩm liên quan, cùng hãng, cùng xu hướng.
Dùng khi user hỏi: "gợi ý cho mình", "nên mua nước hoa nào", "sản phẩm tương tự", "hợp với mùi này", "còn hãng nào khác không".`,
    parameters: z.object({
      query: z.string().describe('Câu hỏi gốc của người dùng'),
    }),
    execute: (async ({ query }: { query: string }) => {
      const search = await SearchService.hybridSearch(query, 3);
      const matchedProducts = search.products;
      let relatedText = '';
      if (matchedProducts.length > 0) {
        const brands = [...new Set(matchedProducts.map((p: any) => p.brandId))].filter(Boolean);
        const productIds = matchedProducts.map((p: any) => p._id);
        const related = await Product.find({
          _id: { $nin: productIds },
          ...(brands.length ? { brandId: { $in: brands } } : {}),
          status: 'active',
        }).select('name price brand').limit(5).lean();
        if (related.length > 0) relatedText = `\nSẢN PHẨM LIÊN QUAN:\n${toCardMarkdown(related)}`;
      }
      let result = '';
      if (matchedProducts.length) result += `SẢN PHẨM KHỚP:\n${toCardMarkdown(matchedProducts)}`;
      else result += 'Chưa tìm thấy sản phẩm phù hợp để gợi ý.';
      if (relatedText) result += relatedText;
      return result;
    }) as any,
  } as any),

  webSearch: tool({
    description: `Tra cứu thông tin bên ngoài như: xu hướng nước hoa mới, top nước hoa bán chạy, review sản phẩm, tin tức ngành nước hoa.
Dùng khi user hỏi: "top nước hoa 2026", "xu hướng mùi hương mới", "review nước hoa X", "nước hoa nào đang hot".`,
    parameters: z.object({
      query: z.string().describe('Câu hỏi gốc của người dùng'),
    }),
    execute: (async ({ query }: { query: string }) => {
      return `USER HỎI VỀ: "${query}"

Hãy trả lời dựa trên kiến thức của bạn về xu hướng nước hoa.
Nếu không chắc chắn, hãy nói "Mình sẽ cập nhật thêm thông tin này, bạn quay lại sau nhé! 😊"
KHÔNG bịa đặt thông tin hay số liệu cụ thể.`;
    }) as any,
  } as any),

  getAdminStats: tool({
    description: `[CHỈ ADMIN] Thống kê và truy vấn dữ liệu quản trị: doanh thu, đơn hàng, người dùng, sản phẩm, brand.
CHỈ dùng tool này khi user là ADMIN.`,
    parameters: z.object({
      query: z.string().describe('Câu hỏi quản trị của admin'),
    }),
    execute: (async ({ query }: { query: string }) => {
      return `ADMIN HỎI VỀ: "${query}"

Hãy trả lời dựa trên kiến thức quản trị của bạn.
Nếu không có dữ liệu cụ thể, hướng dẫn admin vào trang quản trị để xem chi tiết.`;
    }) as any,
  } as any),
} as const;

export type QueryToolName = keyof typeof queryToolsMap;