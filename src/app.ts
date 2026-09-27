import * as dotenv from 'dotenv';
dotenv.config();

import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import { ACCESS_COOKIE } from './utils/auth.ts';

import { authRoutes } from './routes/auth.routes.ts';
import { oauthRoutes } from './routes/oauth.routes.ts';
import { aiRoutes } from './routes/ai.routes.ts';
import { productRoutes } from './routes/product.routes.ts';
import { userRoutes } from './routes/user.routes.ts';
import { brandRoutes } from './routes/brand.routes.ts';
import { tagRoutes } from './routes/tag.routes.ts';
import { orderRoutes } from './routes/order.routes.ts';
import { voucherRoutes } from './routes/voucher.routes.ts';
import { paymentRoutes } from './routes/payment.routes.ts';
import { vnpayRoutes } from './routes/vnpay.routes.ts';
import { miniGameRoutes } from './routes/mini-game.routes.ts';
import { flashSaleRoutes } from './routes/flashSaleRoutes.ts';
import './models/PaymentMethod.ts';
import './models/PendingPayment.ts';
import './models/DailySpin.ts';
import './models/Favorite.ts';
import { userAddressRoutes } from './routes/user-address.routes.ts';

import { categoryRoutes } from './routes/category.routes.ts';

import { dashboardRoutes } from './routes/dashboard.routes.ts';
import { funnelRoutes } from './routes/funnel.routes.ts';
import { favoriteRoutes } from './routes/favorite.routes.ts';
import { cartRoutes } from './routes/cart.routes.ts';
import { adminRoutes } from './routes/admin.routes.ts';
import { mediaRoutes } from './routes/media.routes.ts';
import { reviewRoutes } from './routes/review.routes.ts';
import { newsRoutes } from './routes/newsRoutes.ts';
import { supportTicketRoutes } from './routes/supportTicket.routes.ts';
import { AuthPageController } from './controllers/auth/authPageController.ts';

import rawBody from 'fastify-raw-body';
import multipart from '@fastify/multipart';
import cookie from '@fastify/cookie';
import { register } from './config/metrics.ts';
import { graphqlRoute } from './graphql/route.ts';
import corePlugin from './plugins/core.ts';
import { errorHandler } from './middleware/errorHandler.ts';
import { originGuard } from './middleware/originGuard.ts';
import { getAllowedOrigins } from './config/origins.ts';
import { rateLimitKey, rateLimitMax } from './utils/rateLimit.ts';
import { runHealthChecks, checkDatabase } from './services/HealthCheckService.ts';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    bodyLimit: 10485760,
    trustProxy: true, // chạy sau proxy (Render) — request.ip mới là IP client thật
    logger: process.env.NODE_ENV === 'production'
      ? { level: process.env.LOG_LEVEL || 'info' }
      : {
          level: process.env.LOG_LEVEL || 'info',
          transport: {
            target: 'pino-pretty',
            options: { colorize: true }
          }
        }
  });

  app.register(rawBody, {
    field: 'rawBody',
    global: false,
    encoding: 'utf8',
    runFirst: true,
  });

  app.register(corePlugin);
  app.register(cookie); // parse request.cookies — phục vụ session httpOnly cookie

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  // CORS + origin guard dùng chung danh sách trong config/origins.ts — lệch nhau là
  // hoặc FE bị chặn oan, hoặc cookie cross-site mở đường cho CSRF.
  app.register(cors, {
    origin: getAllowedOrigins(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'X-Products', 'X-Requested-With'],
    exposedHeaders: ['X-Products'],
  });

  // Cookie session phải là SameSite=None để chạy được với topology FE/site khác API,
  // nên không còn lớp chặn cross-site của SameSite=Lax nữa — bù lại bằng check Origin.
  app.addHook('preHandler', originGuard);

  app.register(helmet, { contentSecurityPolicy: false });
  app.register(compress, {
    threshold: 1024,
    encodings: ['br', 'gzip', 'deflate'],
  });

  // Tự động thêm HTTP Cache-Control cho các GET public endpoint
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.method === 'GET' && reply.statusCode === 200) {
      const url = request.url;
      if (
        url.startsWith('/api/products') ||
        url.startsWith('/api/brands') ||
        url.startsWith('/api/categories') ||
        url.startsWith('/api/tags')
      ) {
        if (!reply.hasHeader('Cache-Control')) {
          // Route admin dùng chung prefix với route public (`GET /api/products` là danh
          // sách admin, trả cả draft). Có session thì câu trả lời là dữ liệu riêng —
          // dán `public` cho phép proxy/browser giữ lại rồi phát cho người khác.
          const cookies = (request as any).cookies ?? {};
          const hasSession = Boolean(request.headers.authorization) || Boolean(cookies[ACCESS_COOKIE]);
          reply.header(
            'Cache-Control',
            hasSession ? 'private, no-store' : 'public, max-age=60, stale-while-revalidate=300'
          );
        }
      }
    }
    return payload;
  });

  // GraphQL — phục vụ homepage query
  app.register(graphqlRoute);

  // Global Rate Limiting
  app.register(rateLimit, {
    max: rateLimitMax,
    timeWindow: '1 minute',
    keyGenerator: rateLimitKey,
    allowList: (request: any) => {
      if (request.url?.startsWith('/api/favorites')) return true;
      if (request.url?.startsWith('/api/cart')) return true;
      return false;
    },
  });

  // REST API Routes
  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(oauthRoutes, { prefix: '/api/auth' });

  // Redirect auth helper routes to frontend
  app.get('/login', AuthPageController.getLoginPage);

  app.register(aiRoutes, { prefix: '/api/ai' });
  app.register(productRoutes, { prefix: '/api/products' });
  app.register(userRoutes, { prefix: '/api/users' });
  app.register(brandRoutes, { prefix: '/api/brands' });
  app.register(tagRoutes, { prefix: '/api/tags' });
  app.register(orderRoutes, { prefix: '/api/orders' });
  app.register(userAddressRoutes, { prefix: '/api/user-addresses' });
  app.register(voucherRoutes, { prefix: '/api/vouchers' });
  app.register(paymentRoutes, { prefix: '/api/payments' });
  app.register(categoryRoutes, { prefix: '/api/categories' });
  app.register(favoriteRoutes, { prefix: '/api/favorites' });
  app.register(cartRoutes, { prefix: '/api/cart' });
  app.register(vnpayRoutes, { prefix: '/api/payments' });

  app.register(miniGameRoutes, { prefix: '/api/mini-games' });
  app.register(flashSaleRoutes, { prefix: '/api/flash-sales' });
  app.register(dashboardRoutes, { prefix: '/api/admin' });
  app.register(funnelRoutes, { prefix: '/api/funnel' });
  app.register(mediaRoutes, { prefix: '/api/media' });
  app.register(reviewRoutes, { prefix: '/api/reviews' });
  app.register(newsRoutes, { prefix: '/api' });
  app.register(supportTicketRoutes, { prefix: '/api/support-tickets' });

  // Admin API & SSE — prefix /admin
  app.register(adminRoutes, { prefix: '/admin' });

  app.setErrorHandler(errorHandler);

  app.get('/', async (_request, reply) => {
    return reply.send({
      status: 'ok',
      service: 'L\'essence E-Commerce REST API Server',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/health', async (_request, reply) => {
    const { httpStatus, body } = await runHealthChecks();
    return reply.status(httpStatus).send(body);
  });

  app.get('/ping', async (_request, reply) => {
    const dbCheck = await checkDatabase();
    if (dbCheck.status !== 'up') {
      return reply.status(503).send({ status: 'warming_up', timestamp: new Date().toISOString() });
    }
    return reply.status(200).send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/metrics', async (_request, reply) => {
    reply.header('Content-Type', register.contentType);
    return reply.send(await register.metrics());
  });

  return app;
}