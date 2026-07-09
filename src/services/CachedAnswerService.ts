import { AIFeedback } from '../models/AIFeedback.ts';
import { AIService } from './AIService.ts';
import { redisService } from './RedisService.ts';

const SIMILARITY_THRESHOLD = 0.82; // Ngưỡng tương đồng để coi là "cùng câu hỏi"

export class CachedAnswerService {
  /**
   * Tìm câu trả lời đã được đánh giá cao (4-5★) cho câu hỏi tương tự.
   * Dùng vector search (embedding) để tìm ngữ nghĩa gần nhất.
   */
  static async findCachedAnswer(
    question: string
  ): Promise<{ answer: string; rating: number; messageId: string } | null> {
    try {
      // 1. Kiểm tra Redis cache trước
      const cacheKey = `cached_answer:${Buffer.from(question.trim().toLowerCase()).toString('base64')}`;
      const cached = await redisService.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        console.log(`🚀 [CachedAnswer] Cache hit for: "${question.substring(0, 50)}..."`);
        return parsed;
      }

      // 2. Tạo embedding cho câu hỏi
      const embedding = await AIService.generateEmbedding(question);
      if (!embedding || embedding.length === 0) return null;

      // 3. Vector search trong collection AIFeedback
      const results = await AIFeedback.aggregate([
        {
          $vectorSearch: {
            index: 'feedback_vector_index',
            queryVector: embedding,
            path: 'embedding',
            numCandidates: 20,
            limit: 5,
          },
        },
        {
          $match: {
            rating: { $gte: 4 },
          },
        },
        {
          $addFields: {
            similarity: { $meta: 'vectorSearchScore' },
          },
        },
        {
          $match: {
            similarity: { $gte: SIMILARITY_THRESHOLD },
          },
        },
        {
          $sort: { rating: -1, similarity: -1 },
        },
        {
          $limit: 1,
        },
        {
          $project: {
            answer: 1,
            rating: 1,
            messageId: 1,
            similarity: 1,
          },
        },
      ]);

      if (results.length === 0) {
        console.log(`[CachedAnswer] No cache hit for: "${question.substring(0, 50)}..."`);
        return null;
      }

      const best = results[0];
      const result = {
        answer: best.answer,
        rating: best.rating,
        messageId: best.messageId,
      };

      // 4. Lưu vào Redis cache
      await redisService.set(cacheKey, JSON.stringify(result));

      console.log(`🎯 [CachedAnswer] Found cached answer (rating: ${best.rating}, similarity: ${best.similarity.toFixed(3)})`);
      return result;
    } catch (error: any) {
      console.error('❌ [CachedAnswer] Error:', error.message);
      return null; // Fail gracefully — fallback về AI
    }
  }

  /**
   * Lưu feedback + embedding vào DB để dùng cho lần sau.
   * Chỉ lưu khi rating >= 4.
   */
  static async saveFeedback(data: {
    messageId: string;
    question: string;
    answer: string;
    rating: number;
    userId?: string;
  }): Promise<void> {
    if (data.rating < 4) {
      console.log(`[CachedAnswer] Rating ${data.rating} < 4, skipping save`);
      return;
    }

    try {
      // Tạo embedding cho câu hỏi
      const embedding = await AIService.generateEmbedding(data.question);

      // Upsert: nếu đã có messageId thì update, chưa có thì insert
      await AIFeedback.findOneAndUpdate(
        { messageId: data.messageId },
        {
          $set: {
            question: data.question,
            answer: data.answer,
            rating: data.rating,
            embedding,
            userId: data.userId || null,
            createdAt: new Date(),
          },
        },
        { upsert: true, new: true }
      );

      console.log(`✅ [CachedAnswer] Saved feedback (rating: ${data.rating}) for message: ${data.messageId}`);
    } catch (error: any) {
      console.error('❌ [CachedAnswer] Save error:', error.message);
    }
  }
}