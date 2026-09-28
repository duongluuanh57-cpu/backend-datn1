import { describe, it, expect } from 'vitest';
import { rateLimitKey, rateLimitMax } from '../../utils/rateLimit.ts';
import { generateTokens, ACCESS_COOKIE } from '../../utils/auth.ts';

function fakeReq(headers: Record<string, string> = {}, ip = '1.2.3.4', method = 'POST', cookies: Record<string, string> = {}): any {
  return { headers, ip, method, cookies };
}

describe('rateLimit helpers (chạy ở onRequest — request.user chưa tồn tại)', () => {
  it('ẩn danh → key là IP, quota 120 cho POST', () => {
    const req = fakeReq();
    expect(rateLimitKey(req)).toBe('1.2.3.4');
    expect(rateLimitMax(req)).toBe(120);
  });

  it('GET luôn quota 1000 kể cả ẩn danh', () => {
    expect(rateLimitMax(fakeReq({}, '1.2.3.4', 'GET'))).toBe(1000);
  });

  it('token USER hợp lệ → key là userId, quota 600', () => {
    const { accessToken } = generateTokens('user-1', 'USER');
    const req = fakeReq({ authorization: `Bearer ${accessToken}` });
    expect(rateLimitKey(req)).toBe('user-1');
    expect(rateLimitMax(req)).toBe(600);
  });

  it('token ADMIN hợp lệ → quota 500', () => {
    const { accessToken } = generateTokens('admin-1', 'ADMIN');
    const req = fakeReq({ authorization: `Bearer ${accessToken}` });
    expect(rateLimitKey(req)).toBe('admin-1');
    expect(rateLimitMax(req)).toBe(500);
  });

  it('token hỏng/hết hạn → rớt về IP/120, không throw', () => {
    const req = fakeReq({ authorization: 'Bearer garbage-token' });
    expect(() => rateLimitKey(req)).not.toThrow();
    expect(rateLimitKey(req)).toBe('1.2.3.4');
    expect(rateLimitMax(req)).toBe(120);
  });

  it('dùng refresh token làm Bearer → rớt về anonymous (chống type-confusion)', () => {
    const { refreshToken } = generateTokens('user-1', 'USER');
    const req = fakeReq({ authorization: `Bearer ${refreshToken}` });
    expect(rateLimitKey(req)).toBe('1.2.3.4');
    expect(rateLimitMax(req)).toBe(120);
  });

  // ═══ Kênh thật của FE là httpOnly cookie, không có Authorization header ═══
  it('USER đăng nhập bằng cookie → key là userId, quota 600 (không phải 120/IP)', () => {
    const { accessToken } = generateTokens('user-9', 'USER');
    const req = fakeReq({}, '9.9.9.9', 'POST', { [ACCESS_COOKIE]: accessToken });
    expect(rateLimitKey(req)).toBe('user-9');
    expect(rateLimitMax(req)).toBe(600);
  });

  it('ADMIN đăng nhập bằng cookie → quota 500', () => {
    const { accessToken } = generateTokens('admin-9', 'ADMIN');
    const req = fakeReq({}, '9.9.9.9', 'POST', { [ACCESS_COOKIE]: accessToken });
    expect(rateLimitKey(req)).toBe('admin-9');
    expect(rateLimitMax(req)).toBe(500);
  });

  it('cookie rác → anonymous, không throw', () => {
    const req = fakeReq({}, '8.8.8.8', 'POST', { [ACCESS_COOKIE]: 'khong-phai-jwt' });
    expect(() => rateLimitKey(req)).not.toThrow();
    expect(rateLimitKey(req)).toBe('8.8.8.8');
    expect(rateLimitMax(req)).toBe(120);
  });

  it('có cả Bearer lẫn cookie → theo extractAccessToken, Bearer thắng', () => {
    const bearer = generateTokens('user-bearer', 'USER').accessToken;
    const req = fakeReq({ authorization: `Bearer ${bearer}` }, '7.7.7.7', 'POST', { [ACCESS_COOKIE]: 'khong-phai-jwt' });
    expect(rateLimitKey(req)).toBe('user-bearer');
  });
});
