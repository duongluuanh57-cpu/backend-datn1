import { describe, it, expect, vi } from 'vitest';
import { adminAuthMiddleware } from '../../middleware/adminAuthMiddleware.ts';

vi.mock('../../utils/auth.ts', () => ({
  verifyAccessToken: vi.fn(),
}));

import { verifyAccessToken } from '../../utils/auth.ts';

describe('adminAuthMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to login when no cookie or Authorization header', async () => {
    const req = { headers: {} } as any;
    let redirectUrl = '';
    const reply = { redirect: (u: string) => { redirectUrl = u; return reply; }, status: () => ({ send: () => {} }) } as any;
    await adminAuthMiddleware(req, reply);
    expect(redirectUrl).toBe('/api/auth/login');
  });

  it('reads token from admin_token cookie', async () => {
    vi.mocked(verifyAccessToken).mockReturnValue({ userId: '123', role: 'ADMIN' } as any);
    const req = { headers: { cookie: 'admin_token=valid-jwt-token; other=value' } } as any;
    const reply = { redirect: () => reply, status: () => ({ send: () => {} }) } as any;
    await adminAuthMiddleware(req, reply);
    expect(verifyAccessToken).toHaveBeenCalledWith('valid-jwt-token');
    expect((req as any).token).toBe('valid-jwt-token');
  });

  it('falls back to Authorization Bearer header', async () => {
    vi.mocked(verifyAccessToken).mockReturnValue({ userId: '456', role: 'SUBADMIN' } as any);
    const req = { headers: { authorization: 'Bearer bearer-token-xyz' } } as any;
    const reply = { redirect: () => reply, status: () => ({ send: () => {} }) } as any;
    await adminAuthMiddleware(req, reply);
    expect(verifyAccessToken).toHaveBeenCalledWith('bearer-token-xyz');
    expect((req as any).token).toBe('bearer-token-xyz');
  });

  it('attaches decoded user and token to request on success', async () => {
    const decoded = { userId: '789', role: 'ADMIN', iat: 123, exp: 456 };
    vi.mocked(verifyAccessToken).mockReturnValue(decoded);
    const req = { headers: { cookie: 'admin_token=my-token' } } as any;
    const reply = { redirect: () => reply, status: () => ({ send: () => {} }) } as any;
    await adminAuthMiddleware(req, reply);
    expect((req as any).user).toEqual(decoded);
    expect((req as any).token).toBe('my-token');
  });

  it('returns 403 when role is USER', async () => {
    vi.mocked(verifyAccessToken).mockReturnValue({ userId: '111', role: 'USER' } as any);
    const req = { headers: { cookie: 'admin_token=user-token' } } as any;
    let statusCode = 0, sentBody = '';
    const reply = {
      redirect: () => reply,
      status: (c: number) => { statusCode = c; return { send: (b: any) => { sentBody = b; } }; },
    } as any;
    await adminAuthMiddleware(req, reply);
    expect(statusCode).toBe(403);
    expect(sentBody).toContain('quyền quản trị viên');
  });

  it('redirects to login when token is invalid', async () => {
    vi.mocked(verifyAccessToken).mockImplementation(() => { throw new Error('jwt malformed'); });
    const req = { headers: { cookie: 'admin_token=bad-token' } } as any;
    let redirectUrl = '';
    const reply = { redirect: (u: string) => { redirectUrl = u; return reply; }, status: () => ({ send: () => {} }) } as any;
    await adminAuthMiddleware(req, reply);
    expect(redirectUrl).toBe('/api/auth/login');
  });
});
