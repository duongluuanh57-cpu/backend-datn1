import fp from 'fastify-plugin';
import { connectDB } from '../config/database.ts';
import { connectRedis, redis } from '../config/redis.ts';

export default fp(async (app) => {
  await Promise.all([connectDB(), connectRedis()]);

  app.decorate('db', { mongoose: await import('mongoose') });
  app.decorate('redis', redis);

  app.log.info('Core Plugin: Database and Redis loaded successfully!');
});

declare module 'fastify' {
  interface FastifyInstance {
    db: any;
    redis: typeof redis;
  }
}
