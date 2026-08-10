/**
 * adminAgent — Admin CRUD Agent sử dụng Gemini Function Calling (Vercel AI SDK)
 *
 * Khi admin gửi tin nhắn qua chat dashboard, agent này:
 * 1. Phân tích intent (create/update/delete/find product)
 * 2. Gọi Gemini với function calling để trích xuất tham số
 * 3. Thực thi tool tương ứng (gọi ProductService)
 * 4. Trả về kết quả dạng text cho admin
 */
import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import {
  createProductFromName,
  updateProductFields,
  deleteProductById,
  findProductsByName,
  ensureBrand,
  searchTrending,
} from './adminTools.ts';
import type { ToolResult } from './adminTools.ts';
import { decomposeQuery } from './queryDecomposer.ts';
import { executePlan, summarizeExecution, appendSupplementLink } from './planExecutor.ts';

// Lazy-init provider — tránh crash khi dynamic import (process.env có thể undefined)
let _provider: any = null;
function getProvider() {
  if (!_provider) {
    const apiKey = globalThis.process.env?.GEMINI_API_KEY || globalThis.process.env?.GOOGLE_GENERATIVE_AI_API_KEY || '';
    _provider = createGoogleGenerativeAI({ apiKey });
  }
  return _provider;
}

const MODEL = 'gemini-3.1-flash-lite-preview';

export interface AdminAgentResult {
  type: 'action' | 'text';
  content: string;
}

/**
 * formatToolResult — Biến ToolResult thành text hiển thị cho admin
 */
function formatToolResult(result: ToolResult): string {
  if (!result.success) return result.message;

  let text = result.message;
  if (result.data) {
    if (Array.isArray(result.data)) {
      text += '\n' + result.data.map((p: any) =>
        `  • ${p.name}${p.brand ? ` (${p.brand})` : ''}${p.price ? ` — ${p.price.toLocaleString('vi-VN')}đ` : ''} [ID: ${p.id}]`
      ).join('\n');
    } else if (result.data.id) {
      text += `\n  • Tên: ${result.data.name}`;
      if (result.data.price) text += `\n  • Giá: ${result.data.price.toLocaleString('vi-VN')}đ`;
      if (result.data.brand) text += `\n  • Hãng: ${result.data.brand}`;
      if (result.data.tags) text += `\n  • Tags: ${result.data.tags}`;
      if (result.data.url) text += `\n  Xem tại: ${result.data.url}`;
    }
  }
  return text;
}

/**
 * process — Main entry point cho Admin Agent
 *
 * Hỗ trợ 2 chế độ:
 * 1. Query Decomposition (mới): Phân rã yêu cầu phức tạp → multi-step plan → execute tuần tự
 * 2. Single-tool (cũ): Gọi Gemini function calling với 4 tool CRUD truyền thống
 *
 * @param message - Tin nhắn từ admin
 * @param history - Lịch sử chat (tối đa 10 tin gần nhất)
 */
export async function process(
  message: string,
  history: any[]
): Promise<AdminAgentResult> {
  try {
    // ── Step 0: Query Decomposition ──
    // Phân rã yêu cầu của admin thành multi-step plan
    const plan = await decomposeQuery(message);

    // Nếu plan phức tạp (nhiều bước) → dùng Plan Executor
    if (plan.isComplex && plan.steps.length > 1) {
      console.log(`🔀 [AdminAgent] Using Query Decomposition — ${plan.steps.length} steps`);
      
      const executionResult = await executePlan(plan);
      let summary = await summarizeExecution(executionResult);
      summary = appendSupplementLink(summary, executionResult);

      return {
        type: 'action',
        content: summary,
      };
    }

    // ── Fallback: Single-tool flow (backward compatible) ──
    // Build messages cho Gemini
    const chatMessages = [
      ...history.slice(-10).map((m: any) => ({
        role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
        content: m.content,
      })),
      { role: 'user' as const, content: message },
    ];

    const result = await (generateText as any)({
      model: getProvider().interactions(MODEL),
      system: `Bạn là nhân viên AI của L'essence. Bạn đang nói chuyện với sếp (quản trị viên).

QUY TẮC GIAO TIẾP:
- Xưng hô: xưng "em", gọi admin là "sếp" hoặc "anh/chị".
- Luôn thêm "dạ", "ạ" ở cuối câu khi báo cáo.
- Báo cáo ngắn gọn, rõ ràng, chuyên nghiệp như nhân viên báo cáo sếp.
- Khi hỏi thống kê/doanh thu/báo cáo → trả lời chi tiết, có số liệu cụ thể.
- Sau khi gọi tool, tóm tắt kết quả ngắn gọn. Không thêm lời khuyên không cần thiết.

HÀNH ĐỘNG:
- "tạo sản phẩm X" → create_product
- "sửa/cập nhật giá X thành Y" → update_product
- "xóa sản phẩm X" → delete_product
- "tìm sản phẩm X" → find_products
- "có hãng X chưa" / "tạo hãng X" → ensure_brand
- "nước hoa trending" / "xu hướng" → search_trending
- Không rõ intent → hỏi ngắn gọn`,
      messages: chatMessages,
      tools: {
        create_product: {
          description: 'Tạo sản phẩm mới từ tên. AI sẽ tự động sinh toàn bộ thông tin (mô tả, giá, hãng, tags, size, ...)',
          parameters: z.object({
            name: z.string().describe('Tên sản phẩm cần tạo'),
            price: z.number().optional().describe('Giá mong muốn (nếu admin chỉ định)'),
            brand: z.string().optional().describe('Hãng mong muốn (nếu admin chỉ định)'),
          }),
          execute: async ({ name, price, brand }: { name: string; price?: number; brand?: string }) => {
            console.log(`🔧 [AdminAgent] Tool: create_product("${name}"${price ? `, price=${price}` : ''}${brand ? `, brand=${brand}` : ''})`);
            const toolResult = await createProductFromName(name, { price, brand });
            return formatToolResult(toolResult);
          },
        },
        update_product: {
          description: 'Cập nhật sản phẩm theo ID hoặc tên. Hỗ trợ cập nhật giá, mô tả, hãng, tags, giảm giá...',
          parameters: z.object({
            id: z.string().optional().describe('ID của sản phẩm cần cập nhật (nếu biết)'),
            name: z.string().optional().describe('Tên sản phẩm cần cập nhật (nếu không có ID)'),
            fields: z.record(z.string(), z.any()).describe('Các trường cần cập nhật (VD: { price: 5000000, discountPercentage: 20 })'),
          }),
          execute: async ({ id, name, fields }: { id?: string; name?: string; fields: Record<string, any> }) => {
            console.log(`🔧 [AdminAgent] Tool: update_product(id=${id || '?'}, name=${name || '?'}, fields=${JSON.stringify(fields)})`);
            let targetId = id;
            if (!targetId && name) {
              const found = await findProductsByName(name, 1);
              if (found.success && found.data?.length > 0) {
                targetId = found.data[0].id;
              } else {
                return formatToolResult(found);
              }
            }
            if (!targetId) {
              return 'Cần ID hoặc tên sản phẩm để cập nhật.';
            }
            const toolResult = await updateProductFields(targetId, fields);
            return formatToolResult(toolResult);
          },
        },
        delete_product: {
          description: 'Xóa sản phẩm theo ID hoặc tên',
          parameters: z.object({
            id: z.string().optional().describe('ID của sản phẩm cần xóa (nếu biết)'),
            name: z.string().optional().describe('Tên sản phẩm cần xóa (nếu không có ID)'),
          }),
          execute: async ({ id, name }: { id?: string; name?: string }) => {
            console.log(`🔧 [AdminAgent] Tool: delete_product(id=${id || '?'}, name=${name || '?'})`);
            let targetId = id;
            if (!targetId && name) {
              const found = await findProductsByName(name, 1);
              if (found.success && found.data?.length > 0) {
                targetId = found.data[0].id;
              } else {
                return formatToolResult(found);
              }
            }
            if (!targetId) {
              return 'Cần ID hoặc tên sản phẩm để xóa. Vui lòng cung cấp ID hoặc nhập "tìm sản phẩm X" trước.';
            }
            const toolResult = await deleteProductById(targetId);
            return formatToolResult(toolResult);
          },
        },
        find_products: {
          description: 'Tìm kiếm sản phẩm theo tên',
          parameters: z.object({
            query: z.string().describe('Từ khóa tìm kiếm (tên sản phẩm)'),
          }),
          execute: async ({ query }: { query: string }) => {
            console.log(`🔧 [AdminAgent] Tool: find_products("${query}")`);
            const toolResult = await findProductsByName(query, 5);
            return formatToolResult(toolResult);
          },
        },
        ensure_brand: {
          description: 'Kiểm tra hãng tồn tại. Nếu chưa có → AI tự động tạo hãng (origin, description) và lưu vào DB',
          parameters: z.object({
            name: z.string().describe('Tên hãng cần kiểm tra/tạo'),
          }),
          execute: async ({ name }: { name: string }) => {
            console.log(`🔧 [AdminAgent] Tool: ensure_brand("${name}")`);
            const toolResult = await ensureBrand(name);
            return formatToolResult(toolResult);
          },
        },
        search_trending: {
          description: 'Tìm kiếm nước hoa trending/xu hướng theo hãng hoặc từ khóa',
          parameters: z.object({
            brand: z.string().optional().describe('Tên hãng (nếu muốn lọc theo hãng)'),
            query: z.string().optional().describe('Từ khóa tìm kiếm xu hướng'),
            limit: z.number().optional().describe('Số lượng kết quả (mặc định 5)'),
          }),
          execute: async ({ brand, query, limit }: { brand?: string; query?: string; limit?: number }) => {
            console.log(`🔧 [AdminAgent] Tool: search_trending(brand=${brand || '?'}, query=${query || '?'}, limit=${limit || 5})`);
            const toolResult = await searchTrending(brand, query, limit || 5);
            return formatToolResult(toolResult);
          },
        },
      },
      toolChoice: 'auto',
    });

    const toolCalls = result.toolCalls || [];
    const toolResults = result.toolResults || [];
    const textResponse = result.text || '';

    // Nếu có tool call → lấy kết quả từ tool
    if (toolCalls.length > 0) {
      // Thử lấy output từ toolResults (Vercel AI SDK v6), nếu không có thì fallback sang toolCalls[].call.output
      const rawOutputs: string[] = [];
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i];
        const tr = toolResults[i];
        const output = tr?.result || tr?.output || tc?.output || '';
        if (output) rawOutputs.push(output);
      }
      const toolOutputs = rawOutputs.filter(Boolean).join('\n\n');

      // Debug: log chi tiết để tìm đúng property
      if (!toolOutputs) {
        console.warn('⚠️ [AdminAgent] toolOutputs empty — debug:', JSON.stringify({
          toolCallsLen: toolCalls.length,
          toolResultsLen: toolResults.length,
          firstTc: JSON.stringify(toolCalls[0]),
          firstTrKeys: toolResults[0] ? Object.keys(toolResults[0]) : 'none',
        }));
      }

      // Tạo link supplement đầy đủ nếu tạo sản phẩm
      let supplementTip = '';
      if (toolCalls.some((c: any) => c.toolName === 'create_product')) {
        const baseUrl = globalThis.process.env?.APP_URL || 'http://localhost:4000';
        supplementTip = `\n\nSản phẩm cần bổ sung thông tin: ${baseUrl}/admin/products/supplement`;
      }

      // Gọi Gemini lần 2 để tóm tắt kết quả
      const summary = await (generateText as any)({
        model: getProvider().interactions(MODEL),
        system: 'Bạn là AdminAI. Tóm tắt kết quả vừa thực hiện bằng tiếng Việt ngắn gọn, thân thiện. Chỉ dùng thông tin có sẵn, không tự suy diễn.',
        messages: [
          { role: 'user', content: `Kết quả thực thi:\n${toolOutputs}\n\nHãy tóm tắt cho admin.` },
        ],
      });

      return {
        type: 'action',
        content: (summary.text || toolOutputs) + supplementTip,
      };
    }

    // Không có tool call → Gemini trả lời tự do (có thể hallucinate)
    // Thêm disclaimer nếu text có vẻ chứa số liệu
    if (textResponse && /\d/.test(textResponse)) {
      return {
        type: 'text',
        content: textResponse + '\n\nLưu ý: Tôi không chắc về các con số trên. Hãy hỏi cụ thể hơn như "có bao nhiêu sản phẩm" hoặc "liệt kê thương hiệu" để tôi tra cứu chính xác từ dữ liệu thực tế.',
      };
    }
    return { type: 'text', content: textResponse };
  } catch (error: any) {
    console.error('❌ [AdminAgent] Error:', error);
    return {
      type: 'text',
      content: `Lỗi: ${error.message || 'Đã có lỗi xảy ra khi xử lý yêu cầu.'}`,
    };
  }
}
