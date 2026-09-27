import type { FastifyInstance } from 'fastify';
import { BrandListingController } from '../controllers/brand/brandListingController.ts';
import { BrandMutationController } from '../controllers/brand/brandMutationController.ts';
import { authMiddleware, requireRole } from '../middleware/authMiddleware.ts';

export async function brandRoutes(app: FastifyInstance) {
  // Đường dẫn công khai (Public)
  app.get('/', BrandListingController.getAllBrands);
  app.get('/:id', BrandListingController.getBrandById);

  // Brand là dữ liệu mặc định của web: chỉ cho phép bật/ẩn, không tạo hoặc xóa.
  app.patch('/:id', { preHandler: [authMiddleware, requireRole('ADMIN')] }, BrandMutationController.updateBrandStatus);
}
