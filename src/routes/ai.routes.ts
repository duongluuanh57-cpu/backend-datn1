import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { chatStream } from '../controllers/aiChat/chatStreamController.ts';
import { adminChat } from '../controllers/aiChat/adminChatController.ts';
import { handleFeedback } from '../controllers/aiChat/feedbackController.ts';
import { generateBrand } from '../controllers/aiCatalog/generateBrandController.ts';
import { generateUser, createUserFromAI } from '../controllers/aiCatalog/generateUserController.ts';
import { generateCategory, createCategoryFromAI } from '../controllers/aiCatalog/generateCategoryController.ts';
import { generateTag, createTagFromAI } from '../controllers/aiCatalog/generateTagController.ts';
import { generateVoucher, createVoucherFromAI } from '../controllers/aiCatalog/generateVoucherController.ts';
import { suggestPrice } from '../controllers/aiCatalog/suggestPriceController.ts';
import { productFillMissing } from '../controllers/aiCatalog/productFillMissingController.ts';
import { generateProduct } from '../controllers/aiCatalog/generateProductController.ts';
import { AIVisionController } from '../controllers/AIVisionController.ts';
import { AICoreController } from '../controllers/AICoreController.ts';
import { authMiddleware, requireRole } from '../middleware/authMiddleware.ts';
import { AIPromptSchema, AIGenerateNameSchema } from '../types/feature.types.ts';

export async function aiRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  // POST /api/ai/generate - Gửi câu hỏi cho AI và nhận phản hồi
  server.post('/generate', {
    schema: {
      body: AIPromptSchema,
    },
    handler: AICoreController.generate,
  });

  // POST /api/ai/generate-brand - AI tự động viết câu chuyện thương hiệu và tự động điền form
  server.post('/generate-brand', {
    schema: {
      body: AIGenerateNameSchema,
    },
    handler: generateBrand,
  });

  // POST /api/ai/generate-user - AI tạo thông tin người dùng
  server.post('/generate-user', {
    handler: generateUser,
  });

  // POST /api/ai/generate-category - AI tạo danh mục
  server.post('/generate-category', {
    handler: generateCategory,
  });

  // POST /api/ai/generate-tag - AI tạo tag
  server.post('/generate-tag', {
    handler: generateTag,
  });

  // POST /api/ai/generate-voucher - AI tạo voucher
  server.post('/generate-voucher', {
    handler: generateVoucher,
  });

  // POST /api/ai/create-user - Tạo user từ dữ liệu AI
  server.post('/create-user', {
    preHandler: [authMiddleware, requireRole('ADMIN')],
    handler: createUserFromAI,
  });

  // POST /api/ai/create-category - Tạo category từ dữ liệu AI
  server.post('/create-category', {
    preHandler: [authMiddleware, requireRole('ADMIN')],
    handler: createCategoryFromAI,
  });

  // POST /api/ai/create-tag - Tạo tag từ dữ liệu AI
  server.post('/create-tag', {
    preHandler: [authMiddleware, requireRole('ADMIN')],
    handler: createTagFromAI,
  });

  // POST /api/ai/create-voucher - Tạo voucher từ dữ liệu AI
  server.post('/create-voucher', {
    preHandler: [authMiddleware, requireRole('ADMIN')],
    handler: createVoucherFromAI,
  });

  // POST /api/ai/chat - Streaming Vercel AI SDK (dành cho user)
  server.post('/chat', {
    handler: chatStream,
  });

  // POST /api/ai/admin/chat - Admin chat (yêu cầu auth + role ADMIN)
  server.post('/admin/chat', {
    preHandler: [authMiddleware, requireRole('ADMIN')],
    handler: adminChat,
  });

  // POST /api/ai/suggest-price - Gợi ý giá thị trường + % cộng thêm
  server.post('/suggest-price', {
    handler: suggestPrice,
  });

  // POST /api/ai/feedback - Nhận đánh giá sao từ user, AI tự điều chỉnh và stream phản hồi
  server.post('/feedback', {
    handler: handleFeedback,
  });

  // POST /api/ai/scan-gallery-image - AI quét ảnh và tự động điền tiêu đề và câu trích dẫn song ngữ
  server.post('/scan-gallery-image', {
    handler: AIVisionController.scanGalleryImage,
  });
  // GET /api/ai/health - Health check cho AI services
  server.get('/health', {
    handler: AICoreController.healthCheck,
  });

  // ── Product Interview (Multi-step product creation) ──
  const { handleProductInterview, checkProductCreationIntent } = await import('../controllers/aiChat/productInterviewController.ts');
  server.post('/admin/product-interview', {
    preHandler: [authMiddleware, requireRole('ADMIN')],
    handler: handleProductInterview,
  });
  server.get('/admin/product-interview/check', {
    preHandler: [authMiddleware, requireRole('ADMIN')],
    handler: checkProductCreationIntent,
  });

  // GET /api/ai/admin/random-brands — 5 brand random không trùng cho admin chọn khi tạo sp
  const { Brand } = await import('../models/Brand.ts');
  server.get('/admin/random-brands', {
    preHandler: [authMiddleware, requireRole('ADMIN')],
    handler: async (_req, reply) => {
      const brands = await (Brand as any).aggregate([{ $sample: { size: 5 } }, { $project: { _id: 1, name: 1, origin: 1 } }]);
      return reply.send({ success: true, data: brands });
    },
  });

  // POST /api/ai/admin/product-fill-missing — AI điền thông tin bị thiếu cho sản phẩm
  server.post('/admin/product-fill-missing', {
    preHandler: [authMiddleware, requireRole('ADMIN')],
    handler: productFillMissing,
  });

  // POST /api/ai/generate-product — Tạo thông tin sản phẩm từ tên (dùng cho auto-fill)
  server.post('/generate-product', {
    preHandler: [authMiddleware, requireRole('ADMIN')],
    handler: generateProduct,
  });
}
