/**
 * productInterviewController — REST endpoints cho Product Interview Flow
 *
 * POST /api/ai/admin/product-interview
 *   Body: { sessionId?: string, action: InterviewAction }
 *   Response: { sessionId: string, response: InterviewResponse }
 *
 * GET /api/ai/admin/product-interview/check?message=...
 *   Dùng để kiểm tra message có phải intent "tạo sản phẩm cho hãng X" không
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { ProductInterviewAgent, InterviewStateManager } from '../../services/agent/interviewStateManager.ts';
import type { InterviewAction } from '../../services/agent/interviewStateManager.ts';

/**
 * POST /api/ai/admin/product-interview
 * Xử lý action từ admin trong interview flow
 */
export async function handleProductInterview(req: FastifyRequest, reply: FastifyReply) {
  try {
    const body = req.body as { sessionId?: string; action: InterviewAction };
    const sessionId = body.sessionId;
    const action = body.action;
    const userId = (req as any).user?.userId || 'unknown';

    if (!action) {
      return reply.status(400).send({ error: 'Action is required' });
    }

    // Nếu không có sessionId → bắt đầu interview mới
    if (!sessionId) {
      // action phải chứa brandName
      const startAction = action as any;
      if (!startAction.brandName) {
        return reply.status(400).send({ error: 'Brand name is required to start interview' });
      }

      const result = await ProductInterviewAgent.startInterview(
        startAction.brandName,
        userId,
      );

      return reply.send({
        sessionId: result.sessionId,
        response: result.response,
      });
    }

    // Có sessionId → process action
    const response = await ProductInterviewAgent.processAction(sessionId, action as InterviewAction);

    // Kiểm tra session còn tồn tại không (có thể đã bị xóa sau done)
    const session = InterviewStateManager.getSession(sessionId);
    if (!session) {
      // Session đã kết thúc (done) hoặc hết hạn
      return reply.send({
        sessionId: null,
        response,
      });
    }

    return reply.send({
      sessionId,
      response,
    });

  } catch (error: any) {
    console.error('❌ [ProductInterviewController] Error:', error);
    return reply.status(500).send({ error: error.message || 'Internal Server Error' });
  }
}

/**
 * GET /api/ai/admin/product-interview/check?message=...
 * Kiểm tra message có chứa intent "tạo sản phẩm cho hãng X" không
 * Trả về: { isProductCreation: boolean, brandName?: string }
 */
export async function checkProductCreationIntent(req: FastifyRequest, reply: FastifyReply) {
  try {
    const query = req.query as { message: string };
    const message = query.message?.trim();

    if (!message) {
      return reply.send({ isProductCreation: false });
    }

    // Pattern matching đơn giản
    const lowerMsg = message.toLowerCase();

    // Các pattern: "tạo sản phẩm [cho] hãng X", "tạo sản phẩm [của] brand X", "làm sản phẩm X"
    const patterns = [
      /tạo\s+(?:sản\s+phẩm\s+)?(?:cho|thương\s+hiệu|hãng|brand|của)?\s+(\S+(?:\s+\S+){0,3})/i,
      /làm\s+(?:sản\s+phẩm\s+)?(?:cho|thương\s+hiệu|hãng|brand|của)?\s+(\S+(?:\s+\S+){0,3})/i,
      /thêm\s+(?:sản\s+phẩm\s+)?(?:cho|thương\s+hiệu|hãng|brand|của)?\s+(\S+(?:\s+\S+){0,3})/i,
    ];

    for (const pattern of patterns) {
      const match = lowerMsg.match(pattern);
      if (match) {
        let brandName = match[1].trim();
        // Chuẩn hóa: capitalize first letter
        brandName = brandName.charAt(0).toUpperCase() + brandName.slice(1);

        return reply.send({
          isProductCreation: true,
          brandName,
        });
      }
    }

    return reply.send({ isProductCreation: false });
  } catch (error: any) {
    console.error('❌ [CheckProductCreationIntent] Error:', error);
    return reply.send({ isProductCreation: false });
  }
}