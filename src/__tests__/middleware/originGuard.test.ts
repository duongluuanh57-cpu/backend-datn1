import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { originGuard } from '../../middleware/originGuard.ts';

const originalAllowed = process.env.ALLOWED_ORIGINS;

function makeReq(method: string, url: string, origin?: string, host = 'api.onrender.com') {
  return {
    method,
    url,
    headers: { host, ...(origin === undefined ? {} : { origin }) },
    log: { warn: vi.fn() },
  } as any;
}

function makeReply() {
  const reply: any = {
    statusCode: 200,
    status(code: number) { reply.statusCode = code; return reply; },
    send(body: any) { reply.body = body; return reply; },
  };
  return reply;
}

beforeEach(() => {
  process.env.ALLOWED_ORIGINS = 'https://frontend-datn-tau.vercel.app,http://localhost:3000';
});

afterEach(() => {
  process.env.ALLOWED_ORIGINS = originalAllowed;
});

describe('originGuard', () => {
  it('không chặn GET dù Origin lạ — method đọc không phải mục tiêu CSRF', async () => {
    const reply = makeReply();
    await expect(originGuard(makeReq('GET', '/api/products', 'https://evil.test'), reply)).resolves.toBeUndefined();
    expect(reply.body).toBeUndefined();
  });

  it('cho qua khi không có Origin (VNPay IPN, webhook, curl, health-check)', async () => {
    const reply = makeReply();
    await expect(originGuard(makeReq('POST', '/api/orders'), reply)).resolves.toBeUndefined();
    expect(reply.statusCode).toBe(200);
  });

  it('chặn method ghi có Origin không nằm trong ALLOWED_ORIGINS', async () => {
    const reply = makeReply();
    await originGuard(makeReq('POST', '/api/orders', 'https://evil.test'), reply);
    expect(reply.statusCode).toBe(403);
    expect(reply.body.success).toBe(false);
  });

  it('chặn cả Origin parse không được, không chỉ Origin lạ', async () => {
    const reply = makeReply();
    await originGuard(makeReq('DELETE', '/api/cart/item', 'not a url'), reply);
    expect(reply.statusCode).toBe(403);
  });

  it('cho qua Origin của FE trong ALLOWED_ORIGINS', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const reply = makeReply();
      await expect(originGuard(makeReq(method, '/api/orders', 'https://frontend-datn-tau.vercel.app'), reply)).resolves.toBeUndefined();
      expect(reply.statusCode).toBe(200);
    }
  });

  it('cho qua Origin trỏ đúng host của backend (form admin cũ cùng domain)', async () => {
    const reply = makeReply();
    await expect(
      originGuard(makeReq('POST', '/admin/products/delete', 'https://api.onrender.com', 'api.onrender.com'), reply)
    ).resolves.toBeUndefined();
  });

  it('không cho qua host na ná — so khớp nguyên host, không phải prefix', async () => {
    const reply = makeReply();
    await originGuard(makeReq('POST', '/admin/x', 'https://api.onrender.com.attacker.test'), reply);
    expect(reply.statusCode).toBe(403);
  });

  it('miễn trừ callback VNPay IPN vì server của VNPay có thể gửi Origin lạ', async () => {
    const reply = makeReply();
    await expect(
      originGuard(makeReq('POST', '/api/payments/vnpay-ipn?vnp_Amount=100000', 'https://sandbox.vnpayment.vn'), reply)
    ).resolves.toBeUndefined();
  });

  it('miễn trừ đúng đường dẫn, không miễn trừ cả họ /api/payments', async () => {
    const reply = makeReply();
    await originGuard(makeReq('POST', '/api/payments/vnpay-prepare', 'https://evil.test'), reply);
    expect(reply.statusCode).toBe(403);
  });
});
