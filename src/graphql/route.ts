import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { schema } from './schema.ts';
import { execute, parse, visit } from 'graphql';

export async function graphqlRoute(app: FastifyInstance) {
  // GraphQL rate limit — 50 req/phút/IP
  await app.register(rateLimit, {
    max: 50,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
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
        contextValue: { authorization: req.headers.authorization },
      });

      if (result.errors && result.errors.length > 0) {
        console.error('[GraphQL] Execution errors:', JSON.stringify(result.errors, null, 2));
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