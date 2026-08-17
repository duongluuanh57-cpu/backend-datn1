import type { FastifyInstance } from 'fastify';
import { ProductController } from '../controllers/product/productController.ts';
import { ProductMutationController } from '../controllers/product/productMutationController.ts';
import { authMiddleware, requireRole } from '../middleware/authMiddleware.ts';

export async function productRoutes(app: FastifyInstance) {
  // Lấy danh sách sản phẩm mới (Public)
  app.get('/new', ProductController.getNewProducts);
  app.get('/limited', ProductController.getLimitedProducts);
  app.get('/trending', ProductController.getTrendingProducts);
  app.get('/public', ProductController.getPublicProducts);
  app.get('/sale', ProductController.getSaleProducts);
  
  // Suggest / Autocomplete cho Navbar (must be before /:id)
  app.get('/suggest', ProductController.suggestProducts);

  // Bulk fetch + top brands by views (must be before /:id)
  app.get('/bulk', ProductController.getBulkProducts);
  app.get('/top-brands-by-views', ProductController.getTopBrandsByViews);

  // Quản lý sản phẩm (CRUD) — specific routes MUST come before /:id
  app.get('/', ProductController.getAllProducts);

  // API: Sản phẩm cần bổ sung thông tin (admin only)
  app.get('/needs-supplement', { preHandler: [authMiddleware, requireRole('ADMIN')] }, ProductController.getNeedsSupplement);

  app.get('/:id/admin', {
    preHandler: [authMiddleware, requireRole('ADMIN')],
  }, ProductController.getProductByIdAdmin);
  app.get('/:id/images', ProductController.getProductImages);
  app.get('/:id', ProductController.getProductById);

  // Track product view (public)
  app.post('/:id/track-view', ProductController.trackProductView);
  
  // Tạo/Cập nhật/Xóa sản phẩm (Chỉ ADMIN)
  app.post('/', { preHandler: [authMiddleware, requireRole('ADMIN')] }, ProductMutationController.createProduct);
  app.patch('/:id', { preHandler: [authMiddleware, requireRole('ADMIN')] }, ProductMutationController.updateProduct);
  app.delete('/:id', { preHandler: [authMiddleware, requireRole('ADMIN')] }, ProductMutationController.deleteProduct);
  
  // Xóa hàng loạt sản phẩm
  app.post('/bulk-delete', { preHandler: [authMiddleware, requireRole('ADMIN')] }, ProductMutationController.bulkDeleteProducts);

  // Cập nhật hàng loạt sản phẩm
  app.post('/bulk-update', { preHandler: [authMiddleware, requireRole('ADMIN')] }, ProductMutationController.bulkUpdateProducts);
  
  // Nhân bản sản phẩm
  app.post('/:id/duplicate', { preHandler: [authMiddleware, requireRole('ADMIN')] }, ProductMutationController.duplicateProduct);
}
