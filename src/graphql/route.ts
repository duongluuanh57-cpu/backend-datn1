import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { schema } from './schema.ts';
import { execute, parse, visit } from 'graphql';
import { ACCESS_COOKIE } from '../utils/auth.ts';
import { E2E_SKIP_RATE_LIMIT } from '../utils/rateLimit.ts';

export async function graphqlRoute(app: FastifyInstance) {
  // GraphQL rate limit — 50 req/phút/IP
  await app.register(rateLimit, {
    max: 50,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
    allowList: () => E2E_SKIP_RATE_LIMIT,
    errorResponseBuilder: () => ({
      errors: [{ message: 'Vượt quá giới hạn yêu cầu GraphQL, vui lòng thử lại sau' }],
    }),
  });

  app.post('/api/graphql', {
    config: { rawBody: true },
  }, async (req, reply) => {
    // Fix FST_ERR_CTP_EMPTY_JSON_BODY: skip parse nếu body rỗng
    if (!req.body || Object.keys(req.body as object).length === 0) {
      return reply.status(400).send({ errors: [{ message: 'Empty JSON body — no query provided' }] });
    }
    const { query, variables } = req.body as any;
    if (!query) {
      return reply.status(400).send({ errors: [{ message: 'No query provided' }] });
    }

    // Only anonymous, read-only queries are cacheable. `cartAndFavorites` authenticates
    // from the httpOnly cookie, so a request carrying that cookie is private even with
    // no Authorization header — caching it under a user-independent key would serve one
    // user's cart/favorites to everyone replaying the same query.
    const cookies = (req as any).cookies ?? {};
    const isAuthenticated = Boolean(req.headers.authorization) || Boolean(cookies[ACCESS_COOKIE]);
    const isPublicQuery = !isAuthenticated && !query.includes('mutation');
    const queryHash = isPublicQuery
      ? (await import('node:crypto')).createHash('md5').update(`${query}:${JSON.stringify(variables || {})}`).digest('hex')
      : null;
    const cacheKey = queryHash ? `graphql:${queryHash}` : null;

    if (cacheKey) {
      try {
        const { redis } = await import('../config/redis.ts');
        const cached = await redis.get(cacheKey);
        if (cached) {
          return reply.send(JSON.parse(cached));
        }
      } catch (_) {}
    }

    try {
      const document = parse(query);

      // Depth limit — tối đa 5 levels
      let maxDepth = 0;
      let currentDepth = 0;
      visit(document, {
        Field: {
          enter() { currentDepth++; maxDepth = Math.max(maxDepth, currentDepth); },
          leave() { currentDepth--; },
        },
      });
      if (maxDepth > 5) {
        return reply.status(400).send({
          errors: [{ message: `Query depth ${maxDepth} exceeds maximum allowed 5` }],
        });
      }

      const result = await execute({
        schema,
        document,
        variableValues: variables || {},
        contextValue: { authorization: req.headers.authorization, cookie: (req as any).cookies },
      });

      if (result.errors && result.errors.length > 0) {
        console.error('[GraphQL] Execution errors:', JSON.stringify(result.errors, null, 2));
      } else if (cacheKey && !result.errors) {
        try {
          const { redis } = await import('../config/redis.ts');
          await redis.set(cacheKey, JSON.stringify(result), 'EX', 120); // 2 minutes TTL
        } catch (_) {}
      }

      return reply.send(result);
    } catch (err: any) {
      console.error('[GraphQL] Fatal error:', err);
      return reply.status(400).send({
        errors: [{ message: err.message || 'GraphQL execution failed' }],
      });
    }
  });

  // GET for introspection / testing
  app.get('/api/graphql', async (req, reply) => {
    const { query, variables } = req.query as any;
    if (!query) {
      return reply.send({
        message: 'GraphQL endpoint is ready. Send a POST request with a query.',
      });
    }

    try {
      const document = parse(query);
      const result = await execute({
        schema,
        document,
        variableValues: variables ? JSON.parse(variables) : {},
        contextValue: {},
      });
      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({
        errors: [{ message: err.message || 'GraphQL execution failed' }],
      });
    }
  });
}