import type { FastifyInstance } from 'fastify';
import { ProductListingController } from '../controllers/product/productListingController.ts';
import { ProductMutationController } from '../controllers/product/productMutationController.ts';
import { authMiddleware, requireRole } from '../middleware/authMiddleware.ts';

export async function productRoutes(app: FastifyInstance) {
  // Lấy danh sách sản phẩm mới (Public)
  app.get('/new', ProductListingController.getNewProducts);
  app.get('/limited', ProductListingController.getLimitedProducts);
  app.get('/trending', ProductListingController.getTrendingProducts);
  app.get('/public', ProductListingController.getPublicProducts);
  app.get('/sale', ProductListingController.getSaleProducts);
  
  // Suggest / Autocomplete cho Navbar (must be before /:id)
  app.get('/suggest', ProductListingController.suggestProducts);

  // Bulk fetch + top brands by views (must be before /:id)
  app.get('/bulk', ProductListingController.getBulkProducts);
  app.get('/top-brands-by-views', ProductListingController.getTopBrandsByViews);

  // Quản lý sản phẩm (CRUD) — specific routes MUST come before /:id
  app.get('/', ProductListingController.getAllProducts);

  // API: Sản phẩm cần bổ sung thông tin (admin only)
  app.get('/needs-supplement', { preHandler: [authMiddleware, requireRole('ADMIN', 'SUBADMIN')] }, ProductListingController.getNeedsSupplement);

  app.get('/:id/admin', {
    preHandler: [authMiddleware, requireRole('ADMIN', 'SUBADMIN')],
  }, ProductListingController.getProductByIdAdmin);
  app.get('/:id/images', ProductListingController.getProductImages);
  app.get('/:id', ProductListingController.getProductById);

  // Track product view (public)
  app.post('/:id/track-view', ProductListingController.trackProductView);
  
  // Tạo/Cập nhật/Xóa sản phẩm (Chỉ Admin/Subadmin)
  app.post('/', { preHandler: [authMiddleware, requireRole('ADMIN', 'SUBADMIN')] }, ProductMutationController.createProduct);
  app.patch('/:id', { preHandler: [authMiddleware, requireRole('ADMIN', 'SUBADMIN')] }, ProductMutationController.updateProduct);
  app.delete('/:id', { preHandler: [authMiddleware, requireRole('ADMIN', 'SUBADMIN')] }, ProductMutationController.deleteProduct);
  
  // Xóa hàng loạt sản phẩm
  app.post('/bulk-delete', { preHandler: [authMiddleware, requireRole('ADMIN', 'SUBADMIN')] }, ProductMutationController.bulkDeleteProducts);
}
