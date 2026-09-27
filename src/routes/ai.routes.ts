import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { chatStream } from '../controllers/aiChat/chatStreamController.ts';
import { generateProduct } from '../controllers/aiCatalog/generateProductController.ts';
import { authMiddleware, optionalAuthMiddleware, requireRole } from '../middleware/authMiddleware.ts';

export async function aiRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  // POST /api/ai/generate-product - AI tạo thông tin sản phẩm từ tên
  server.post('/generate-product', {
    preHandler: [authMiddleware, requireRole('ADMIN')],
    handler: generateProduct,
  });

  // POST /api/ai/chat - Streaming Vercel AI SDK.
  // Công khai theo chủ đích: đây là trợ lý mua hàng ở trang chủ, khách chưa đăng nhập vẫn
  // phải hỏi được. Nhưng mỗi câu là một lần gọi Gemini tính tiền nên cần quota riêng,
  // chặt hơn quota ẩn danh toàn cục (120/phút). optionalAuthMiddleware để QueryRouter
  // thấy được role thật (branch thống kê chỉ ADMIN).
  server.post('/chat', {
    preHandler: optionalAuthMiddleware,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    handler: chatStream,
  });
}
