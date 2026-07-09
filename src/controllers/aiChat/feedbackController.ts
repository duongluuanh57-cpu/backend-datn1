import type { FastifyRequest, FastifyReply } from 'fastify';
import { AIService } from '../../services/AIService.ts';

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

    // Build a tailored system prompt based on the numeric rating.
    const ratingContext: Record<number, string> = {
      5: `Khách hàng vừa đánh giá câu trả lời của bạn 5 sao — hoàn hảo, tuyệt vời.
Hãy phản hồi với sự vui mừng chân thành, cảm ơn họ, và hỏi nhẹ nhàng xem bạn có thể giúp gì thêm không.
Dùng 1-2 câu ngắn, thân thiện, dùng icon nhẹ nhàng (ví dụ: ✨ 🌸).`,

      4: `Khách hàng vừa đánh giá câu trả lời của bạn 4 sao — tốt nhưng cần cải thiện.
Hãy cảm ơn họ chân thành, thừa nhận rằng bạn sẽ cố gắng hơn, và hỏi xem còn điều gì chưa ổn để bạn hỗ trợ tốt hơn.
Dùng 2-3 câu, giọng nhẹ nhàng, cầu thị, dùng icon gần gũi (ví dụ: 🙏 😊).`,

      3: `Khách hàng vừa đánh giá câu trả lời của bạn 3 sao — tạm được, không xuất sắc.
Hãy thừa nhận điều đó một cách khiêm tốn và hỏi khách muốn bạn điều chỉnh thêm điều gì.
Đừng quá xin lỗi, chỉ cần tỏ ra cởi mở, muốn cải thiện. 2-3 câu, dùng icon trung tính (😐 💬).`,

      2: `Khách hàng vừa đánh giá câu trả lời của bạn 2 sao — tệ.
Hãy xin lỗi thực sự, thừa nhận bạn chưa đáp ứng đúng nhu cầu của họ.
Đề nghị họ mô tả lại câu hỏi để bạn thử lại hoặc kết nối với hỗ trợ viên thực của L'essence.
2-3 câu, giọng thành thật, có trách nhiệm, icon phù hợp (😕 🙏).`,

      1: `Khách hàng vừa đánh giá câu trả lời của bạn 1 sao — rất tệ.
Đây là phản hồi nghiêm trọng. Hãy xin lỗi sâu sắc và chân thành nhất có thể.
Thừa nhận hoàn toàn rằng bạn đã thất bại trong việc hỗ trợ họ.
Cam kết sẽ cải thiện và đề nghị họ liên hệ trực tiếp với đội ngũ L'essence nếu cần hỗ trợ khẩn cấp.
2-4 câu, giọng nghiêm túc, có cảm xúc, icon phù hợp (😞 💔 🙏).`,
    };

    const systemPrompt = `
Bạn là Tinco - Trợ lý AI của L'essence. Bạn vừa nhận được đánh giá từ khách hàng.
${ratingContext[rating] || ratingContext[3]}

QUAN TRỌNG:
- KHÔNG đề cập đến số sao, điểm số hoặc bất kỳ con số đánh giá nào trong câu trả lời.
- KHÔNG giải thích cơ chế đánh giá.
- Phản hồi bằng tiếng Việt tự nhiên, ngắn gọn.
- Chỉ viết đúng phần phản hồi, không thêm tiêu đề hay lời dẫn.
    `.trim();

    const userPrompt = 'Phản hồi đánh giá này.';

    const streamMessages = [{ role: 'user', content: userPrompt }];
    const response = await AIService.createChatStream(streamMessages, systemPrompt);

    if (!response.body) throw new Error('No body from AI service');

    const origin = req.headers.origin || 'http://localhost:3000';
    reply.raw.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'X-Accel-Buffering': 'no',
      'Cache-Control': 'no-cache, no-transform',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
    });

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      reply.raw.write(value);
    }

    reply.raw.end();
    return reply;
  } catch (error: any) {
    console.error('❌ [AIChatController.handleFeedback Error]:', error);
    if (!reply.sent && !reply.raw.headersSent) {
      return reply.status(500).send({ error: error.message || 'Internal Server Error' });
    }
    if (!reply.raw.writableEnded) reply.raw.end();
    return reply;
  }
}