/**
 * POST /api/ai/chat
 * Chat — dùng QueryRouter để phân loại và xử lý câu hỏi
 * 
 * Query Router phân tích câu hỏi → chọn đúng data source:
 * - Vector Search: tìm theo mùi hương, cảm xúc
 * - SQL/MongoDB: tìm theo tên, hãng, giá
 * - Web Search: tra cứu tin tức, xu hướng
 * - Graph Search: gợi ý sản phẩm liên quan
 * - Admin Query: thống kê quản trị (chỉ ADMIN)
 * 
 * Greeting/Confusion/Gibberish được xử lý trực tiếp, không gọi AI.
 */
import { Readable } from 'node:stream';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { QueryRouterService } from '../../services/queryRouter/QueryRouterService.ts';
import type { UserRole } from '../../services/queryRouter/queryRouterTypes.ts';

/**
 * POST /api/ai/chat
 * User Chat — sử dụng Query Router
 */
export async function chatStream(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { messages } = req.body as { messages: any[] };
    const userRole = ((req as any).user?.role || undefined) as UserRole;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return reply.status(400).send({ error: 'Messages array required' });
    }

    const lastMessage = messages[messages.length - 1]?.content || '';
    if (!lastMessage.trim()) throw new Error('Empty message');

    // ── Query Routing ──
    const result = await QueryRouterService.route({
      message: lastMessage,
      messages,
      userRole,
    });

    // ── Trả về kết quả ──
    if (result.type === 'direct' && result.content) {
      return reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .status(200)
        .send(result.content);
    }

    if (result.type === 'stream' && result.streamResponse) {
      const fb = result.streamResponse;
      if (!fb.body) throw new Error('No body from AI');

      return reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .header('Cache-Control', 'no-cache, no-transform')
        .header('X-Accel-Buffering', 'no')
        .send(Readable.fromWeb(fb.body as any));
    }

    // Fallback: trả về câu trả lời thân thiện thay vì 500
    return reply
      .header('Content-Type', 'text/plain; charset=utf-8')
      .status(200)
      .send('Dạ hiện tại Tinco đang bận một chút, bạn thử gửi lại câu hỏi sau vài giây nhé! :3');

  } catch (error: any) {
    console.error('❌ [chatStream Error]:', error);
    return reply
      .header('Content-Type', 'text/plain; charset=utf-8')
      .status(200)
      .send('Dạ hiện tại hệ thống AI đang hơi bận một chút, bạn vui lòng gửi lại câu hỏi trong giây lát nhé! Cảm ơn bạn :3');
  }
}

