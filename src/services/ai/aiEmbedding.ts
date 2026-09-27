/**
 * aiEmbedding — Delegate sang aiInteractionService (Vercel AI SDK)
 * 
 * Giữ signature cũ để backward compatible
 */
import { generateEmbeddingVector } from './aiInteractionService.ts';
import crypto from 'crypto';
import { redis } from '../../config/redis.ts';
import { preprocessForEmbedding } from '../../utils/textNormalizer.ts';

/**
 * Generate embedding vector for text, with deterministic fallback
 * Preprocesses text (expand abbreviations, remove stopwords, normalize) before embedding
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const processed = preprocessForEmbedding(text);

  const cacheKey = `embedding:${crypto.createHash('md5').update(processed).digest('hex')}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log(`[Embedding] Cache hit for: "${processed.substring(0, 40)}..."`);
        return parsed;
      }
    }
  } catch {} /* ignore */

  try {
    const vector = await generateEmbeddingVector(processed);
    // Cache 24h
    try { await redis.set(cacheKey, JSON.stringify(vector), 'EX', 86400); } catch {}
    return vector;
  } catch (error) {
    // KHÔNG trả vector giả từ hash: Atlas nearest-neighbour trên vector nhiễu
    // sẽ gợi ý sản phẩm ngẫu nhiên mà user không thể phân biệt được.
    // Trả [] → caller tự degrade (SearchService .catch(() => []) → keyword-only,
    // Product.ts post-save guard `vector.length > 0`).
    console.warn('⚠️ [Embedding] Gemini embedding failed, returning empty vector (degrade to keyword search):', error);
    return [];
  }
}
