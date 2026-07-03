import * as dotenv from 'dotenv';
dotenv.config();

import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import view from '@fastify/view';
import ejs from 'ejs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { authRoutes } from './routes/auth.routes.ts';
import { aiRoutes } from './routes/ai.routes.ts';
import { visitsRoutes } from './routes/visits.routes.ts';
import { oauthRoutes } from './routes/oauth.routes.ts';
import { productRoutes } from './routes/product.routes.ts';
import { userRoutes } from './routes/user.routes.ts';
import { brandRoutes } from './routes/brand.routes.ts';
import { tagRoutes } from './routes/tag.routes.ts';
import { orderRoutes } from './routes/order.routes.ts';
import { voucherRoutes } from './routes/voucher.routes.ts';
import { paymentRoutes } from './routes/payment.routes.ts';
import { vnpayRoutes } from './routes/vnpay.routes.ts';
import { miniGameRoutes } from './routes/mini-game.routes.ts';
import './models/Payment.ts';
import './models/PaymentMethod.ts';
import './models/PendingPayment.ts';
import './models/Favorite.ts';
import './models/Cart.ts';
import { userAddressRoutes } from './routes/user-address.routes.ts';

import { categoryRoutes } from './routes/category.routes.ts';
import { contentRoutes } from './routes/content.routes.ts';
import { funnelRoutes } from './routes/funnel.routes.ts';
import { dailySummaryRoutes } from './routes/dailySummary.routes.ts';
import { startDailySummaryCron } from './cron/dailySummary.ts';
import { favoriteRoutes } from './routes/favorite.routes.ts';
import { cartRoutes } from './routes/cart.routes.ts';
import { adminRoutes } from './routes/admin.routes.ts';
import { readFileSync } from 'fs';

import rawBody from 'fastify-raw-body';
import corePlugin from './plugins/core.ts';
import { errorHandler } from './middleware/errorHandler.ts';
import { runHealthChecks, checkDatabase } from './services/HealthCheckService.ts';
import { register } from './config/metrics.ts';
import { graphqlRoute } from './graphql/route.ts';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    bodyLimit: 10485760,
    logger: {
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

  // View engine — EJS cho auth pages (login/register)
  app.register(view, {
    engine: { ejs },
    root: join(__dirname, 'views'),
    viewExt: 'ejs',
  });


  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || ['http://localhost:3000', 'https://frontend-datn-tau.vercel.app'];
  app.register(cors, {
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
  });

  app.register(helmet, { contentSecurityPolicy: false });
  app.register(compress);

  // GraphQL — phục vụ homepage query (dùng graphql trực tiếp, không qua Yoga)
  app.register(graphqlRoute);

  // Global Rate Limiting
  app.register(rateLimit, {
    max: (request: any) => {
      if (request.method === 'GET' || request.method === 'HEAD') return 1000;
      const user = (request as any).user;
      if (user?.role === 'ADMIN') return 500;
      if (user?.role === 'SUBADMIN') return 500;
      if (user?.role === 'USER') return 600;
      return 120;
    },
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      return (request as any).user?._id?.toString() || request.ip;
    },
    allowList: (request: any) => {
      if (request.url?.startsWith('/api/favorites')) return true;
      if (request.url?.startsWith('/api/cart')) return true;
      if (request.url === '/api/auth/login-page' || request.url === '/api/auth/register-page') return true;
      if (request.url === '/api/auth/login' || request.url === '/api/auth/register') return true;
      return false;
    },
  });

  // Routes
  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(oauthRoutes, { prefix: '/api/auth' });
  app.register(aiRoutes, { prefix: '/api/ai' });
  app.register(productRoutes, { prefix: '/api/products' });
  app.register(userRoutes, { prefix: '/api/users' });
  app.register(brandRoutes, { prefix: '/api/brands' });
  app.register(tagRoutes, { prefix: '/api/tags' });
  app.register(orderRoutes, { prefix: '/api/orders' });
  app.register(userAddressRoutes, { prefix: '/api/user-addresses' });

  app.register(voucherRoutes, { prefix: '/api/vouchers' });
  app.register(paymentRoutes, { prefix: '/api/payments' });
  app.register(visitsRoutes, { prefix: '/api/visits' });
  app.register(categoryRoutes, { prefix: '/api/categories' });
  app.register(contentRoutes, { prefix: '/api/content' });
  app.register(favoriteRoutes, { prefix: '/api/favorites' });
  app.register(cartRoutes, { prefix: '/api/cart' });
  app.register(vnpayRoutes, { prefix: '/api/payments' });
  app.register(funnelRoutes, { prefix: '/api/funnel' });
  app.register(miniGameRoutes, { prefix: '/api/mini-games' });
  app.register(dailySummaryRoutes, { prefix: '/api/admin' });

  // Start background cron jobs
  startDailySummaryCron();

  // Admin Panel (SSR) — prefix /admin
  app.register(adminRoutes, { prefix: '/admin' });

  // Serve admin static files (CSS)
  app.get('/admin/static/admin.css', async (_request, reply) => {
    const css = readFileSync(join(__dirname, 'views', 'admin', 'admin.css'), 'utf-8');
    reply.header('Content-Type', 'text/css');
    return reply.send(css);
  });


  app.setErrorHandler(errorHandler);

  app.get('/', async (request, reply) => {
    const { body } = await runHealthChecks();
    return reply.status(200).send({
      message: 'Elite SaaS Backend API is running smoothly!',
      version: process.env.APP_VERSION || '1.0.0',
      systemStatus: body.status,
      timestamp: new Date().toISOString()
    });
  });

  app.get('/health', async (request, reply) => {
    const { httpStatus, body } = await runHealthChecks();
    return reply.status(httpStatus).send(body);
  });

  app.get('/ping', async (request, reply) => {
    const dbCheck = await checkDatabase();
    if (dbCheck.status !== 'up') {
      return reply.status(503).send({ status: 'warming_up', timestamp: new Date().toISOString() });
    }
    return reply.status(200).send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/metrics', async (request, reply) => {
    reply.header('Content-Type', register.contentType);
    return reply.send(await register.metrics());
  });

  return app;
}