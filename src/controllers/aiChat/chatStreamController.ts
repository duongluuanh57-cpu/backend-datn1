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
    const { messages, image } = req.body as { messages: any[], image?: string };
    const userRole = ((req as any).user?.role || undefined) as UserRole;

    if ((!messages || !Array.isArray(messages)) && !image) {
      return reply.status(400).send({ error: 'Messages or Image required' });
    }

    const lastMessage = messages[messages.length - 1]?.content || (image ? 'User uploaded an image' : '');
    if (!lastMessage) throw new Error('Empty message');

    // ── HÌNH ẢNH: fallback sang direct stream ──
    if (image) {
      console.log(`📸 [chatStream] Image detected — falling back to direct stream`);
      return handleImageStream(req, reply, messages, image);
    }

    // ── Query Routing ──
    const result = await QueryRouterService.route({
      message: lastMessage,
      messages,
      image,
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

    // Fallback
    return reply.status(500).send({ error: 'No response generated' });

  } catch (error: any) {
    console.error('❌ [chatStream Error]:', error);
    return reply.status(500).send({ error: error.message || 'Internal Server Error' });
  }
}

/**
 * Xử lý image riêng — gọi Gemini direct stream
 */
async function handleImageStream(
  req: FastifyRequest,
  reply: FastifyReply,
  messages: any[],
  image: string
) {
  const { AIService } = await import('../../services/AIService.ts');
  const systemFallback = `Bạn là Tinco - Trợ lý AI bán nước hoa cao cấp. Trả lời ngắn gọn, thân thiện, dùng icon :3.`;

  const fb = await AIService.createChatStream(messages, systemFallback, image);
  if (!fb.body) throw new Error('No body from AI');

  return reply
    .header('Content-Type', 'text/plain; charset=utf-8')
    .header('Cache-Control', 'no-cache, no-transform')
    .header('X-Accel-Buffering', 'no')
    .send(Readable.fromWeb(fb.body as any));
}
