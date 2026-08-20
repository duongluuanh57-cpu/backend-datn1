import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminAuthMiddleware } from '../../middleware/adminAuthMiddleware.ts';

vi.mock('../../utils/auth.ts', () => ({
  verifyAccessToken: vi.fn(),
  generateTokens: vi.fn().mockReturnValue({ accessToken: 'default-token' }),
}));

import { verifyAccessToken, generateTokens } from '../../utils/auth.ts';

describe('adminAuthMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assigns default admin when no cookie or Authorization header', async () => {
    const req = { headers: {} } as any;
    const reply = {} as any;
    await adminAuthMiddleware(req, reply);
    expect(req.user.role).toBe('ADMIN');
    expect(req.token).toBe('default-token');
  });

  it('reads token from admin_token cookie', async () => {
    vi.mocked(verifyAccessToken).mockReturnValue({ userId: '123', role: 'ADMIN' } as any);
    const req = { headers: { cookie: 'admin_token=valid-jwt-token; other=value' } } as any;
    const reply = {} as any;
    await adminAuthMiddleware(req, reply);
    expect(verifyAccessToken).toHaveBeenCalledWith('valid-jwt-token');
    expect((req as any).token).toBe('valid-jwt-token');
  });

  it('falls back to Authorization Bearer header', async () => {
    vi.mocked(verifyAccessToken).mockReturnValue({ userId: '456', role: 'ADMIN' } as any);
    const req = { headers: { authorization: 'Bearer bearer-token-xyz' } } as any;
    const reply = {} as any;
    await adminAuthMiddleware(req, reply);
    expect(verifyAccessToken).toHaveBeenCalledWith('bearer-token-xyz');
    expect((req as any).token).toBe('bearer-token-xyz');
  });

  it('attaches decoded user and token to request on success', async () => {
    const decoded = { userId: '789', role: 'ADMIN', iat: 123, exp: 456 };
    vi.mocked(verifyAccessToken).mockReturnValue(decoded as any);
    const req = { headers: { cookie: 'admin_token=my-token' } } as any;
    const reply = {} as any;
    await adminAuthMiddleware(req, reply);
    expect((req as any).user).toEqual({ ...decoded, role: 'ADMIN' });
    expect((req as any).token).toBe('my-token');
  });

  it('falls back to default admin when token is invalid', async () => {
    vi.mocked(verifyAccessToken).mockImplementation(() => { throw new Error('jwt malformed'); });
    const req = { headers: { cookie: 'admin_token=bad-token' } } as any;
    const reply = {} as any;
    await adminAuthMiddleware(req, reply);
    expect(req.user.role).toBe('ADMIN');
    expect(req.token).toBe('default-token');
  });
});
