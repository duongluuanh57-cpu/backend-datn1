import type { FastifyInstance } from 'fastify';
import { adminAuthMiddleware } from '../middleware/adminAuthMiddleware.ts';
import { csrfProtection } from '../middleware/csrfMiddleware.ts';
import { DashboardStatsController } from '../controllers/admin/dashboardStatsController.ts';
import { AuditLog } from '../models/AuditLog.ts';
import { addSseClient, removeSseClient } from '../utils/adminSseEmitter.ts';
import { detectFrontendUrl } from '../utils/viewHelpers.ts';
import crypto from 'crypto';

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

  // ── SSE: Real-time order notifications (GET only, exempt from CSRF) ──
  app.get('/order-events', { preHandler: adminAuthMiddleware }, async (request, reply) => {
    const clientId = crypto.randomUUID();
    const origin = (request.headers.origin as string) || '*';
    reply.raw.setHeader('Access-Control-Allow-Origin', origin);
    reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.flushHeaders();
    reply.raw.write(': connected\n\n');
    addSseClient(clientId, reply);
    const heartbeat = setInterval(() => {
      try { reply.raw.write(': ping\n\n'); } catch { clearInterval(heartbeat); }
    }, 25000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      removeSseClient(clientId);
    });
    await new Promise<void>(() => {});
  });

  // Dashboard Stats API
  app.get('/dashboard-stats', DashboardStatsController.getSummaryStats);

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

  // Redirect /admin root to frontend admin dashboard
  app.get('/', async (req, reply) => {
    const frontendUrl = detectFrontendUrl(req);
    return reply.redirect(`${frontendUrl.replace(/\/+$/, '')}/admin`);
  });
}