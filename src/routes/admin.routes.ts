import type { FastifyInstance } from 'fastify';
import { adminAuthMiddleware } from '../middleware/adminAuthMiddleware.ts';
import { csrfProtection } from '../middleware/csrfMiddleware.ts';
import { AdminPageController } from '../controllers/admin/AdminPageController.ts';
import { AdminCRUDController } from '../controllers/admin/AdminCRUDController.ts';
import { AdminCRUDControllerPart2 } from '../controllers/admin/AdminCRUDControllerPart2.ts';
import { DashboardStatsController } from '../controllers/admin/dashboardStatsController.ts';
import { Tag } from '../models/Tag.ts';
import { ProductTag } from '../models/ProductTag.ts';
import { AuditLog } from '../models/AuditLog.ts';
import { UserRepository } from '../repositories/UserRepository.ts';
import { FlashSaleService } from '../services/FlashSaleService.ts';
import { renderEjs, renderAdminPage } from '../utils/viewHelpers.ts';

export async function adminRoutes(app: FastifyInstance) {
  // Rate limit cho admin: 120 req/phút (2x so với user thường)
  app.addHook('preHandler', adminAuthMiddleware);


  // Rate limit cứng cho form submit
  app.addHook('preHandler', async (req, reply) => {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      const ip = req.ip;
      const key = `admin-rl:${ip}`;
      // Đơn giản: dùng biến global để đếm (production nên dùng Redis)
      const now = Date.now();
      const windowMs = 60000;
      const maxReqs = 30;

      if (!(app as any).__rateLimitStore) (app as any).__rateLimitStore = {};
      const store = (app as any).__rateLimitStore;
      if (!store[key]) store[key] = [];
      store[key] = store[key].filter((t: number) => now - t < windowMs);
      if (store[key].length >= maxReqs) {
        return reply.status(429).send('Vượt quá giới hạn thao tác. Vui lòng thử lại sau 1 phút.');
      }
      store[key].push(now);
    }
  });

  // CSRF bảo vệ tất cả POST/PUT/DELETE
  app.addHook('preHandler', csrfProtection);

  // Dashboard
  app.get('/', AdminPageController.dashboard);
  app.get('/dashboard-stats', DashboardStatsController.getSummaryStats);

  // ── Products CRUD ──
  app.get('/products', AdminCRUDController.productList);
  app.get('/products/create', AdminCRUDController.productCreate);
  app.get('/products/:id', AdminCRUDController.productDetail);
  app.post('/products/:id/delete', AdminCRUDController.productDelete);

  // ── Edit product (full form) — phải đặt TRƯỚC /products/supplement/:id
  app.get('/products/:id/edit', AdminCRUDController.productEdit);

  // ── Supplement sản phẩm: chi tiết (phải đặt TRƯỚC /products/supplement) ──
  app.get('/products/supplement/:id', AdminCRUDController.productSupplementDetail);

  // ── Supplement sản phẩm: danh sách ──
  app.get('/products/supplement', AdminCRUDController.productSupplement);

  // ── Brands CRUD ──
  app.get('/brands', AdminCRUDController.brandList);
  app.get('/brands/create', AdminCRUDController.brandCreate);
  app.get('/brands/:id/edit', AdminCRUDController.brandEdit);
  app.get('/brands/:id', AdminCRUDController.brandDetail);
  app.post('/brands/:id/delete', AdminCRUDController.brandDelete);

  // ── Categories CRUD ──
  app.get('/categories', AdminCRUDController.categoryList);
  app.get('/categories/create', AdminCRUDController.categoryCreate);
  app.get('/categories/:id/edit', AdminCRUDController.categoryEdit);
  app.get('/categories/:id', AdminCRUDController.categoryDetail);
  app.post('/categories/:id/delete', AdminCRUDController.categoryDelete);

  // ── Tags CRUD ──
  app.get('/tags', async (req, reply) => {
    const u = await UserRepository.findById((req as any).user?.userId);
    const apiToken = (req as any).token || '';
    const config = JSON.stringify({
      entityName:'tag', title:'Tags', apiEndpoint:'/api/tags', itemsPath:'items', totalPath:'total', totalPagesPath:'totalPages',
      columns:[
        {key:'index', label:'STT', render:'rowIndex'},
        {key:'name', label:'Tag'},
        {key:'slug', label:'Slug'},
        {key:'productCount', label:'Số SP liên kết', fallback:'0'},
        {key:'status', label:'Trạng thái', render:'editableStatus', statusOptions:[{v:'active',l:'Hoạt động'},{v:'inactive',l:'Ẩn'}], statusApiEndpoint:'/api/tags/:id'},
      ],
      deleteEndpoint:'/admin/tags/:id/delete',
      bulkDeleteEndpoint:'/api/tags/bulk-delete',
      detailEndpoint:'/admin/tags/:id',
      searchPlaceholder:'Tìm tag...',
    });
    const b = renderEjs('admin/crud/list.ejs', { apiToken, config });
    return renderAdminPage(reply, u, 'Tags', 'tags', b, apiToken, 'Quản lý Cửa hàng');
  });
  app.get('/tags/create', AdminCRUDController.tagCreate);
  app.get('/tags/:id/edit', AdminCRUDController.tagEdit);
  app.get('/tags/:id', AdminCRUDController.tagDetail);
  app.post('/tags/:id/delete', async (req, reply) => {
    const tagId = (req.params as any).id;
    await Tag.findByIdAndDelete(tagId);
    await ProductTag.deleteMany({ tagId: tagId });
    await FlashSaleService.clearCache();
    return reply.redirect('/admin/tags?toast=Đã+xóa+tag&type=success');
  });

  // ── Orders CRUD ──
  app.get('/orders', AdminCRUDControllerPart2.orderList);
  app.get('/orders/:id', AdminCRUDControllerPart2.orderDetail);

  // ── Vouchers CRUD ──
  app.get('/vouchers', AdminCRUDControllerPart2.voucherList);
  app.get('/vouchers/:id', AdminCRUDControllerPart2.voucherDetail);
  app.get('/vouchers/create', AdminCRUDControllerPart2.voucherCreate);
  app.get('/vouchers/:id/edit', AdminCRUDControllerPart2.voucherEdit);
  app.post('/vouchers/:id/delete', AdminCRUDControllerPart2.voucherDelete);

  // ── Flash Sales CRUD ──
  app.get('/flash-sales', AdminCRUDControllerPart2.flashSaleList);
  app.get('/flash-sales/create', AdminCRUDControllerPart2.flashSaleCreate);
  app.get('/flash-sales/:id/edit', AdminCRUDControllerPart2.flashSaleEdit);

  // ── Users CRUD ──
  app.get('/users', AdminCRUDControllerPart2.userList);
  app.get('/system-users', AdminCRUDControllerPart2.systemUserList);
  app.post('/users/:id/delete', AdminCRUDControllerPart2.userDelete);


  // ── Reviews CRUD ──
  app.get('/reviews', AdminCRUDControllerPart2.reviewList);
  app.get('/reviews/:id', AdminCRUDControllerPart2.reviewDetail);
  app.post('/reviews/:id/moderate', AdminCRUDControllerPart2.reviewModerate);

  // ── Settings ──
  app.get('/settings', AdminPageController.settingsPage);
  app.post('/settings', AdminPageController.settingsSave);

  // ── Activity Log API ──
  app.get('/activity-log-api', async (req, reply) => {
    const page = parseInt((req.query as any).page, 10) || 1;
    const limit = Math.min(parseInt((req.query as any).limit, 10) || 30, 100);
    const skip = (page - 1) * limit;
    const action = (req.query as any).action || '';
    const resource = (req.query as any).resource || '';

    const filter: any = {};
    if (action) filter.action = action;
    if (resource) filter.resource = resource;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .populate('userId', 'username fullName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    return reply.send({
      success: true,
      data: {
        items: logs.map((l: any) => ({
          _id: l._id,
          userId: l.userId,
          action: l.action,
          resource: l.resource,
          metadata: l.metadata || {},
          status: l.status,
          createdAt: l.createdAt,
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  });

  // ── Activity Log page ──
  app.get('/activity-log', AdminPageController.activityLog);

  // ── Architecture Diagram ──
  app.get('/architecture', AdminPageController.architecture);

  // Logout
  app.post('/logout', AdminPageController.logout);
}