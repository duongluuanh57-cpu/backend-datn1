import type { FastifyInstance } from 'fastify';
import { adminAuthMiddleware } from '../middleware/adminAuthMiddleware.ts';
import { csrfProtection } from '../middleware/csrfMiddleware.ts';
import { detectFrontendUrl } from '../utils/viewHelpers.ts';

export async function adminRoutes(app: FastifyInstance) {
  // Rate limit cho admin: 120 req/phút
  app.addHook('preHandler', adminAuthMiddleware);

  // Rate limit cứng cho form submit / write operations
  app.addHook('preHandler', async (req, reply) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const ip = req.ip;
      const key = `admin-rl:${ip}`;
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

  // Lưu ý: API dashboard dùng thật nằm ở dashboardRoutes (prefix /api/admin/*),
  // frontend gọi qua baseURL `${origin}/api`. Không còn alias trùng /dashboard-stats ở đây.

  // Redirect /admin root to frontend admin dashboard
  app.get('/', async (req, reply) => {
    const frontendUrl = detectFrontendUrl(req);
    return reply.redirect(`${frontendUrl.replace(/\/+$/, '')}/admin`);
  });
}