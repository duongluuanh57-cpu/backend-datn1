import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import { originGuard } from '../../middleware/originGuard.ts';

const originalAllowed = process.env.ALLOWED_ORIGINS;
const FE = 'https://frontend-datn-tau.vercel.app';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.register(cors, { origin: [FE], credentials: true, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] });
  // Mô phỏng đúng app.ts: hook thêm ở root scope, route đăng ký ở scope con SAU đó.
  app.addHook('preHandler', originGuard);
  app.post('/api/orders', async () => ({ success: true, handled: true }));
  app.get('/api/orders', async () => ({ success: true, handled: true }));
  await app.ready();
});

// originGuard đọc env theo từng request (không cache), nên phải set trước MỖI test —
// set một lần ở beforeAll rồi restore ở afterEach sẽ làm test sau chạy với danh sách
// allow khác hẳn.
beforeEach(() => {
  process.env.ALLOWED_ORIGINS = FE;
});

afterAll(() => {
  process.env.ALLOWED_ORIGINS = originalAllowed;
});

describe('originGuard gắn vào app thật', () => {
  it('chặn POST cross-site ngay cả khi CORS cho qua preflight', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { origin: 'https://evil.test' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().handled).toBeUndefined();
  });

  it('cho POST từ FE đã allow', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/orders', headers: { origin: FE } });
    expect(res.statusCode).toBe(200);
    expect(res.json().handled).toBe(true);
  });

  it('preflight OPTIONS vẫn do @fastify/cors trả lời, guard không chen vào', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/orders',
      headers: { origin: FE, 'access-control-request-method': 'POST' },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('GET cross-site không bị chặn (method đọc)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/orders', headers: { origin: 'https://evil.test' } });
    expect(res.statusCode).toBe(200);
  });
});
