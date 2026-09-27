import fp from 'fastify-plugin';
import mongoose from 'mongoose';
import { connectDB } from '../config/database.ts';
import { connectRedis, redis } from '../config/redis.ts';

export default fp(async (app) => {
  // Không await: listen() mở port ngay thay vì chờ TLS handshake sang Atlas (trần
  // serverSelectionTimeoutMS 8s) + Upstash (race 6s) — mạng chậm là boot treo 8 giây
  // không log gì. Mongoose buffer command cho tới khi connect, redis.ts có fallback
  // (isRedisAvailable) và /ping đã trả warming_up cho tới khi DB sẵn sàng.
  void Promise.all([connectDB(), connectRedis()]);

  app.decorate('db', { mongoose });
  app.decorate('redis', redis);

  app.log.info('Core Plugin: Database and Redis connections started');
});

declare module 'fastify' {
  interface FastifyInstance {
    db: any;
    redis: typeof redis;
  }
}
