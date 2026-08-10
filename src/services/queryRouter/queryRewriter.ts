/**
 * QueryRewriter — Gemini-based query expansion + rewriting
 *
 * Trước khi embed/search, rewrite user query để:
 * 1. Fix typos
 * 2. Expand abbreviations
 * 3. Add synonym context
 * 4. Clarify ambiguous intent
 *
 * Chỉ activate khi query đủ dài và phức tạp (> 5 từ hoặc có dấu hỏi)
 */

import { normalizeForSearch, expandAbbreviations } from '../../utils/textNormalizer.ts';
import { expandQueryWithSynonyms, resolveBrandName } from '../../utils/synonymMap.ts';

/**
 * Fast path: rule-based rewrite không cần gọi Gemini
 * Dùng cho simple queries
 */
function fastRewrite(query: string): { rewritten: string; method: string } | null {
  const lower = query.toLowerCase().trim();

  // 1. Expand abbreviations (CK, D&G, YSL...)
  const expanded = expandAbbreviations(lower);
  if (expanded !== lower) {
    return { rewritten: expanded, method: 'abbreviation_expansion' };
  }

  // 2. Resolve brand typos
  const words = lower.split(/\s+/);
  for (const word of words) {
    const resolved = resolveBrandName(word);
    if (resolved && resolved.toLowerCase() !== word) {
      const rewritten = lower.replace(word, resolved);
      return { rewritten, method: 'brand_typo_fix' };
    }
  }

  // 3. Expand synonyms
  const { expanded: synExpanded, synonyms } = expandQueryWithSynonyms(lower);
  if (synonyms.length > 0) {
    return { rewritten: synExpanded, method: 'synonym_expansion' };
  }

  return null;
}

/**
 * LLM-based rewrite cho complex queries
 * Gemini sẽ rewrite query để rõ ràng hơn cho search
 */
async function llmRewrite(query: string): Promise<{ rewritten: string; method: string }> {
  try {
    const { generateText } = await import('ai');
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
    const { z } = await import('zod');

    const provider = createGoogleGenerativeAI({
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    });

    const result = await (generateText as any)({
      model: provider.interactions('gemini-3.1-flash-lite-preview'),
      system: `Bạn là query rewriter cho hệ thống tìm nước hoa. 
NHIỆM VIED: Rewrite câu hỏi của user thành query rõ ràng hơn cho search engine.

QUY TẮC:
- Giữ nguyên ý nghĩa gốc
- Bỏ từ thừa, câu thừa
- Fix typos (vd: "channel" → "Chanel")
- Thêm brand name nếu user chỉ nói tên nước hoa (vd: "Sauvage" → "Dior Sauvage")
- Thêm ngữ cảnh nếu query mơ hồ (vd: "thơm" → "nước hoa thơm")
- KHÔNG thêm thông tin không có trong query gốc
- Trả về 1 câu rewrite duy nhất, không giải thích

VÍ DỤ:
- "ê cái j thơm thơm á" → "nước hoa mùi thơm dễ chịu"
- "dior có j mới" → "Dior nước hoa mới nhất"
- "cái giá mềm mềm" → "nước hoa giá rẻ phải chăng"
- "ck cho nữ" → "Calvin Klein nước hoa nữ"
- "mùi gì hợp đi party" → "nước hoa phù hợp đi party dạ tiệc"`,
      messages: [{ role: 'user', content: query }],
      tools: {
        rewriteQuery: {
          description: 'Rewrite query để search rõ ràng hơn',
          parameters: z.object({
            rewritten: z.string().describe('Query đã được rewrite'),
            changes: z.array(z.string()).describe('Mô tả ngắn gọn những gì đã thay đổi'),
          }),
          execute: async ({ rewritten, changes }: { rewritten: string; changes: string[] }) => {
            return { rewritten, changes };
          },
        },
      },
      toolChoice: { type: 'tool', toolName: 'rewriteQuery' },
    });

    const toolCalls = result.toolCalls;
    if (toolCalls && toolCalls.length > 0) {
      const input = toolCalls[0].input as { rewritten: string; changes: string[] };
      if (input.rewritten && input.rewritten !== query) {
        console.log(`🔄 [QueryRewrite] "${query}" → "${input.rewritten}" (${input.changes.join(', ')})`);
        return { rewritten: input.rewritten, method: 'llm_rewrite' };
      }
    }

    return { rewritten: query, method: 'no_change' };
  } catch (error: any) {
    console.warn('⚠️ [QueryRewrite] LLM rewrite failed:', error?.message);
    return { rewritten: query, method: 'error_fallback' };
  }
}

/**
 * Main rewrite function — fast path first, LLM fallback for complex queries
 */
export async function rewriteQuery(query: string): Promise<{
  original: string;
  rewritten: string;
  method: string;
}> {
  const trimmed = query.trim();
  if (!trimmed) return { original: query, rewritten: query, method: 'empty' };

  // Fast path: rule-based rewrite
  const fastResult = fastRewrite(trimmed);
  if (fastResult) {
    return { original: query, ...fastResult };
  }

  // LLM rewrite chỉ cho queries phức tạp (> 5 từ HOẶC chứa dấu ?)
  const isComplex = trimmed.split(/\s+/).length > 5 || /[?!]/.test(trimmed);
  if (isComplex) {
    return { original: query, ...(await llmRewrite(trimmed)) };
  }

  // Simple query — just normalize for search
  const normalized = normalizeForSearch(trimmed);
  return { original: query, rewritten: normalized, method: 'normalize_only' };
}
