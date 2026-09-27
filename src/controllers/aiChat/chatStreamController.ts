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
import { randomUUID } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { QueryRouterService } from '../../services/queryRouter/QueryRouterService.ts';
import type { UserRole } from '../../services/queryRouter/queryRouterTypes.ts';

// ── Guardrail lịch sử chat ──
// Client có thể gửi cả history dài → nổ token/chi phí Gemini. Chỉ giữ ~10 turn
// (mỗi turn = 1 user + 1 assistant) và cắt ngắn nội dung từng message.
const MAX_HISTORY_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4000;

type ChatMessage = { role: 'user' | 'assistant' | 'model'; content: string };

/** Validate + sanitize messages từ client; trả null nếu sai shape */
function sanitizeMessages(raw: any): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ChatMessage[] = [];
  for (const m of raw.slice(-MAX_HISTORY_MESSAGES)) {
    if (!m || typeof m !== 'object') return null;
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'model') return null;
    if (typeof m.content !== 'string') return null;
    out.push({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) });
  }
  return out;
}

/**
 * POST /api/ai/chat
 * User Chat — sử dụng Query Router
 */
export async function chatStream(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { messages: rawMessages } = req.body as { messages: any };
    const userRole = ((req as any).user?.role || undefined) as UserRole;

    const messages = sanitizeMessages(rawMessages);
    if (!messages) {
      return reply.status(400).send({
        error: 'Messages must be a non-empty array of { role: user|assistant|model, content: string }',
      });
    }

    const lastMessage = messages[messages.length - 1]?.content || '';
    if (!lastMessage.trim()) {
      return reply.status(400).send({ error: 'Message content is required' });
    }

    // ── Query Routing ──
    const result = await QueryRouterService.route({
      message: lastMessage,
      messages,
      userRole,
    });

    // ── Trả về kết quả ──
    if (result.type === 'direct' && result.content) {
      const messageId = randomUUID();
      return reply
        .header('Content-Type', 'application/json')
        .status(200)
        .send({ messageId, content: result.content });
    }

    if (result.type === 'stream' && result.streamResponse) {
      const messageId = randomUUID();
      const fb = result.streamResponse;
      if (!fb.body) throw new Error('No body from AI');

      const nodeStream = Readable.fromWeb(fb.body as any);
      // Client ngắt kết nối → destroy stream để cancel upstream (Gemini ngừng
      // sinh token trả phí). Destroy sẽ lan về ReadableStream.cancel() của AI SDK.
      const onReqClose = () => {
        if (!nodeStream.destroyed) nodeStream.destroy();
      };
      req.raw.on('close', onReqClose);
      nodeStream.on('close', () => req.raw.off('close', onReqClose));

      return reply
        .header('Content-Type', 'text/plain; charset=utf-8')
        .header('Cache-Control', 'no-cache, no-transform')
        .header('X-Accel-Buffering', 'no')
        .header('X-Message-ID', messageId)
        .send(nodeStream);
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

