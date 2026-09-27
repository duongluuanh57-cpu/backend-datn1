import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminAuthMiddleware } from '../../middleware/adminAuthMiddleware.ts';
import { UnauthorizedError, ForbiddenError } from '../../utils/errors.ts';

vi.mock('../../utils/auth.ts', () => ({
  verifyAccessToken: vi.fn(),
  isSessionRevoked: vi.fn().mockResolvedValue(false),
}));

import { verifyAccessToken, isSessionRevoked } from '../../utils/auth.ts';

describe('adminAuthMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSessionRevoked).mockResolvedValue(false);
  });

  it('reads token from admin_token cookie and attaches ADMIN user', async () => {
    vi.mocked(verifyAccessToken).mockReturnValue({ userId: '123', role: 'ADMIN' } as any);
    const req = { headers: { cookie: 'admin_token=valid-jwt-token; other=value' } } as any;
    const reply = {} as any;
    await adminAuthMiddleware(req, reply);
    expect(verifyAccessToken).toHaveBeenCalledWith('valid-jwt-token');
    expect(req.user).toEqual({ userId: '123', role: 'ADMIN' });
    expect(req.token).toBe('valid-jwt-token');
  });

  it('falls back to Authorization Bearer header', async () => {
    vi.mocked(verifyAccessToken).mockReturnValue({ userId: '456', role: 'ADMIN' } as any);
    const req = { headers: { authorization: 'Bearer bearer-token-xyz' } } as any;
    const reply = {} as any;
    await adminAuthMiddleware(req, reply);
    expect(verifyAccessToken).toHaveBeenCalledWith('bearer-token-xyz');
    expect(req.token).toBe('bearer-token-xyz');
  });

  it('throws UnauthorizedError when no token provided', async () => {
    const req = { headers: {} } as any;
    const reply = {} as any;
    await expect(adminAuthMiddleware(req, reply)).rejects.toThrow(UnauthorizedError);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedError when token is invalid', async () => {
    vi.mocked(verifyAccessToken).mockImplementation(() => { throw new Error('jwt malformed'); });
    const req = { headers: { cookie: 'admin_token=bad-token' } } as any;
    const reply = {} as any;
    await expect(adminAuthMiddleware(req, reply)).rejects.toThrow(UnauthorizedError);
  });

  it('throws ForbiddenError when role is not ADMIN', async () => {
    vi.mocked(verifyAccessToken).mockReturnValue({ userId: '789', role: 'USER' } as any);
    const req = { headers: { cookie: 'admin_token=user-token' } } as any;
    const reply = {} as any;
    await expect(adminAuthMiddleware(req, reply)).rejects.toThrow(ForbiddenError);
  });

  it('rejects an admin access token issued before a password change', async () => {
    vi.mocked(verifyAccessToken).mockReturnValue({ userId: '123', role: 'ADMIN', iat: 1 } as any);
    vi.mocked(isSessionRevoked).mockResolvedValue(true);
    const req = { headers: { cookie: 'admin_token=old-admin-token' } } as any;
    const reply = {} as any;
    await expect(adminAuthMiddleware(req, reply)).rejects.toThrow('Phiên đăng nhập đã hết hạn');
    expect(req.user).toBeUndefined();
  });
});
