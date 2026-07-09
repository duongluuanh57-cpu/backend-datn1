/**
 * queryDecomposer — Phân rã yêu cầu phức tạp của admin thành multi-step plan
 *
 * Sử dụng Gemini để bóc tách yêu cầu như:
 *   "Tạo 5 sản phẩm nước hoa Dior trending 2026"
 * Thành plan:
 *   [
 *     { tool: "ensure_brand", args: { name: "Dior" } },
 *     { tool: "search_trending", args: { brand: "Dior", limit: 5 } },
 *     { tool: "generate_product", args: { name: "$step_2.products[0].name", ... }, dependsOn: [2] },
 *     ...
 *   ]
 */
import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

const provider = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const MODEL = 'gemini-3.1-flash-lite-preview';

/** Một step trong plan */
export interface PlanStep {
  id: number;
  tool: string;
  args: Record<string, any>;
  dependsOn: number[];
  condition?: string;
  description: string;
}

/** Toàn bộ plan */
export interface DecomposedPlan {
  isComplex: boolean;
  steps: PlanStep[];
  rawMessage: string;
}

/**
 * decomposeQuery — Phân rã message của admin thành plan steps
 *
 * @param message - Tin nhắn của admin
 * @returns DecomposedPlan (nếu isComplex=false → dùng flow cũ single-tool)
 */
export async function decomposeQuery(
  message: string,
): Promise<DecomposedPlan> {
  const prompt = `Bạn là Query Decomposer cho admin dashboard L'essence. Phân tích yêu cầu của admin và phân rã thành các bước tuần tự.

TOOLS CÓ SẴN (dùng ĐÚNG tên tool, đúng tham số):
1. ensure_brand(name) → Kiểm tra brand tồn tại. Nếu chưa có → AI tự tạo brand (origin + description). Trả về { brandId, name, existed }.
2. search_trending(brand?, query?, limit) → Tìm nước hoa trending. Trả về { products: [{ name, brand, description }] }.
3. generate_product(name, brand?, price?) → Tạo sản phẩm mới. AI tự sinh mô tả, giá, size, tags, SEO... Trả về { productId, name, price }.
4. find_products(query, limit?) → Tìm sản phẩm trong DB theo tên. Trả về { products: [{ id, name, brand, price }] }.
5. update_product(id?, name?, fields) → Cập nhật sản phẩm. fields là object các trường cần sửa.
6. delete_product(id?, name?) → Xóa sản phẩm.

QUY TẮC PHÂN RÃ:
- Nếu admin nói "tạo X sản phẩm hãng Y" → dùng ensure_brand(Y) → search_trending(brand=Y, limit=X) → generate_product cho từng sản phẩm
- Nếu admin nói "tạo sản phẩm X" → CHỈ 1 step generate_product
- Nếu admin nói "tìm sản phẩm X" → CHỈ 1 step find_products
- Nếu admin nói "cập nhật/sửa X" → CHỈ 1 step update_product
- Nếu admin nói "xóa X" → CHỈ 1 step delete_product
- CHỈ phân rã khi yêu cầu THỰC SỰ phức tạp (nhiều bước). Nếu chỉ 1 hành động → trả về 1 step duy nhất.

OUTPUT FORMAT — TRẢ VỀ ĐÚNG JSON (không markdown, không giải thích):
{
  "isComplex": true/false,
  "steps": [
    {
      "id": 1,
      "tool": "tên_tool",
      "args": { "param1": "value1" },
      "dependsOn": [],
      "condition": null,
      "description": "Mô tả ngắn tiếng Việt"
    }
  ]
}

LƯU Ý QUAN TRỌNG:
- Khi 1 step generate_product cần kết quả từ step search_trending trước đó, dùng cú pháp tham chiếu: "$step_N.data.products[0].name" để chỉ tên sản phẩm đầu tiên từ step N.
- condition dùng để skip step nếu điều kiện không thỏa. VD: "$1.data.existed === true" để skip ensure_brand. Để null nếu không có condition.
- dependsOn là mảng ID của các step cần hoàn thành trước.

ADMIN MESSAGE: "${message}"

Hãy phân rã và trả về JSON:`;

  try {
    const result = await (generateText as any)({
      model: provider.interactions(MODEL),
      system: 'Bạn là Query Decomposer. Chỉ trả về JSON, không markdown, không giải thích thêm.',
      messages: [{ role: 'user', content: prompt }],
      tools: {
        output_plan: {
          description: 'Output the decomposed plan as JSON',
          parameters: z.object({
            isComplex: z.boolean().describe('true nếu plan có nhiều step, false nếu chỉ 1 step đơn giản'),
            steps: z.array(z.object({
              id: z.number(),
              tool: z.string(),
              args: z.record(z.any()),
              dependsOn: z.array(z.number()),
              condition: z.string().nullable(),
              description: z.string(),
            })),
          }),
          execute: async (params: any) => params,
        },
      },
      toolChoice: { type: 'tool', toolName: 'output_plan' },
    });

    const toolCalls = result.toolCalls || [];
    if (toolCalls.length > 0) {
      const plan = toolCalls[0].input as DecomposedPlan;
      plan.rawMessage = message;
      console.log(`🔀 [Decomposer] Plan: ${plan.steps.length} steps, isComplex=${plan.isComplex}`);
      plan.steps.forEach(s => console.log(`  Step ${s.id}: ${s.tool}(${JSON.stringify(s.args)}) dependsOn=[${s.dependsOn}]`));
      return plan;
    }

    // Fallback: single step
    return {
      isComplex: false,
      steps: [{ id: 1, tool: 'generate_product', args: { name: message }, dependsOn: [], description: 'Tạo sản phẩm' }],
      rawMessage: message,
    };
  } catch (error: any) {
    console.error('❌ [QueryDecomposer] Error:', error?.message || error);
    // Fallback: trả về single step để không break flow
    return {
      isComplex: false,
      steps: [{ id: 1, tool: 'generate_product', args: { name: message }, dependsOn: [], description: 'Tạo sản phẩm (fallback)' }],
      rawMessage: message,
    };
  }
}