import type { FastifyRequest, FastifyReply } from 'fastify';
import { CachedAnswerService } from '../../services/CachedAnswerService.ts';

/**
 * POST /api/ai/feedback
 * Receives a star rating (1–5) from the user after an AI response.
 * Saves high-rated answers (4-5★) to cache for future reuse.
 */
export async function handleFeedback(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { messageId, rating, question, answer } = req.body as {
      messageId: string;
      rating: number;
      question?: string;
      answer?: string;
    };
    const userId = (req as any).user?._id || undefined;

    if (!rating || rating < 1 || rating > 5) {
      return reply.status(400).send({ error: 'Rating must be between 1 and 5' });
    }

    // ── Lưu feedback vào DB nếu có đủ question + answer ──
    if (question && answer) {
      await CachedAnswerService.saveFeedback({
        messageId,
        question,
        answer,
        rating,
        userId,
      });
    }

    return reply.status(200).send({ success: true });
  } catch (error: any) {
    console.error('❌ [AIChatController.handleFeedback Error]:', error);
    return reply.status(500).send({ error: error.message || 'Internal Server Error' });
  }
}