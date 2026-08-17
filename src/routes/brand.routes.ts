import type { FastifyInstance } from 'fastify';
import { BrandListingController } from '../controllers/brand/brandListingController.ts';
import { BrandMutationController } from '../controllers/brand/brandMutationController.ts';
import { authMiddleware, requireRole } from '../middleware/authMiddleware.ts';

export async function brandRoutes(app: FastifyInstance) {
  // Đường dẫn công khai (Public)
  app.get('/', BrandListingController.getAllBrands);
  app.get('/origins', BrandListingController.getBrandOrigins);
  app.post('/ai-suggest', BrandListingController.aiSuggestBrand);
  app.get('/:id', BrandListingController.getBrandById);

  // Đường dẫn bảo mật (Chỉ dành cho Admin)
  app.post('/', { preHandler: [authMiddleware, requireRole('ADMIN')] }, BrandMutationController.createBrand);
  app.patch('/:id', { preHandler: [authMiddleware, requireRole('ADMIN')] }, BrandMutationController.updateBrand);
  app.delete('/:id', { preHandler: [authMiddleware, requireRole('ADMIN')] }, BrandMutationController.deleteBrand);
  app.post('/bulk-delete', { preHandler: [authMiddleware, requireRole('ADMIN')] }, BrandMutationController.bulkDeleteBrands);
}
