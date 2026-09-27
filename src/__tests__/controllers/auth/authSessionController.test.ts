import { describe, it, expect, vi } from 'vitest';
import { AuthSessionController } from '../../../controllers/auth/authSessionController.ts';
import { UnauthorizedError } from '../../../utils/errors.ts';

vi.mock('../../../services/auth/authRegisterService.ts', () => ({
  AuthRegisterService: {
    register: vi.fn(),
  },
}));

vi.mock('../../../services/auth/authSessionService.ts', () => ({
  AuthSessionService: {
    login: vi.fn(),
    logout: vi.fn(),
  },
}));

vi.mock('../../../utils/auth.ts', () => ({
  verifyTurnstile: vi.fn(),
  verifyRefreshToken: vi.fn(),
  generateTokens: vi.fn(),
  refreshTokenBlacklistKey: vi.fn((_t: string, jti?: string) => (jti ? `blacklist:jti:${jti}` : `blacklist:${_t}`)),
  isSessionRevoked: vi.fn().mockResolvedValue(false),
  revokeUserSessions: vi.fn().mockResolvedValue(undefined),
  toPublicUser: vi.fn((u: any) => ({ id: u._id || u.id, role: u.role, username: u.username, email: u.email })),
  ACCESS_COOKIE: 'access_token',
  REFRESH_COOKIE: 'refresh_token',
  ADMIN_COOKIE: 'admin_token',
}));

vi.mock('../../../config/redis.ts', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('../../../repositories/UserRepository.ts', () => ({
  UserRepository: { findById: vi.fn(), findByIdWithSecurity: vi.fn() },
}));

import { AuthRegisterService } from '../../../services/auth/authRegisterService.ts';
import { AuthSessionService } from '../../../services/auth/authSessionService.ts';
import { verifyTurnstile, verifyRefreshToken, generateTokens, isSessionRevoked } from '../../../utils/auth.ts';
import { redis } from '../../../config/redis.ts';
import { UserRepository } from '../../../repositories/UserRepository.ts';

describe('AuthSessionController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyTurnstile).mockResolvedValue(undefined);
    vi.mocked(isSessionRevoked).mockResolvedValue(false);
  });

  describe('login', () => {
    it('puts the session in httpOnly cookies and never in the body', async () => {
      const mockResult: any = {
        user: { id: '123', username: 'test', role: 'USER' },
        tokens: { accessToken: 'at', refreshToken: 'rt' },
      };
      vi.mocked(AuthSessionService.login).mockResolvedValue(mockResult);

      const req = { body: { email: 'a@b.com', password: 'pwd' }, ip: '1.2.3.4', headers: { 'user-agent': 'test' } } as any;
      let sentBody: any = {};
      const setCookie = vi.fn();
      const reply = { send: (b: any) => { sentBody = b; return reply; }, status: () => reply, header: () => reply, setCookie, clearCookie: vi.fn() } as any;

      await AuthSessionController.login(req, reply);
      expect(sentBody.success).toBe(true);
      expect(sentBody.data).toEqual({ user: mockResult.user });
      // Token chỉ được đi qua cookie — XSS đọc body không lấy được refresh token 7 ngày.
      expect(setCookie).toHaveBeenCalledWith('access_token', 'at', expect.anything());
      expect(setCookie).toHaveBeenCalledWith('refresh_token', 'rt', expect.anything());
    });

    it('rejects when turnstile verification fails', async () => {
      vi.mocked(verifyTurnstile).mockRejectedValueOnce(new UnauthorizedError('Xác minh bảo mật thất bại.'));
      const req = { body: { email: 'a@b.com', password: 'pwd' }, ip: '1.2.3.4', headers: {} } as any;
      const reply = { send: () => {}, status: () => reply, header: () => reply } as any;
      await expect(AuthSessionController.login(req, reply)).rejects.toThrow(UnauthorizedError);
      expect(AuthSessionService.login).not.toHaveBeenCalled();
    });

    it('throws when AuthSessionService.login fails', async () => {
      vi.mocked(AuthSessionService.login).mockRejectedValue(new Error('Bad credentials'));
      const req = { body: { email: 'a@b.com', password: 'x' }, ip: '1.2.3.4', headers: {} } as any;
      const reply = { send: () => {}, status: () => reply, header: () => reply } as any;
      await expect(AuthSessionController.login(req, reply)).rejects.toThrow('Bad credentials');
    });
  });

  describe('register', () => {
    it('returns 201 with user data on success', async () => {
      const mockResult: any = {
        user: { id: '123', username: 'newuser' },
        tokens: { accessToken: 'at', refreshToken: 'rt' },
      };
      vi.mocked(AuthRegisterService.register).mockResolvedValue(mockResult);

      const req = { body: { username: 'newuser', email: 'a@b.com', password: 'pwd' }, ip: '1.2.3.4' } as any;
      let statusCode = 0, sentBody: any = {};
      const setCookie = vi.fn();
      const reply = {
        status: (c: number) => { statusCode = c; return { send: (b: any) => { sentBody = b; } }; },
        setCookie,
        clearCookie: vi.fn(),
      } as any;

      await AuthSessionController.register(req, reply);
      expect(statusCode).toBe(201);
      expect(sentBody.success).toBe(true);
      expect(sentBody.data).toEqual({ user: mockResult.user });
      expect(setCookie).toHaveBeenCalledWith('access_token', 'at', expect.anything());
      expect(setCookie).toHaveBeenCalledWith('refresh_token', 'rt', expect.anything());
    });
  });

  describe('refresh', () => {
    it('rotates the session into cookies and returns the user (no token in body)', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(verifyRefreshToken).mockReturnValue({ userId: '123' } as any);
      vi.mocked(UserRepository.findByIdWithSecurity).mockResolvedValue({ _id: '123', role: 'USER', passwordHash: '', email: '', username: '', status: 'active', createdAt: new Date() } as any);
      vi.mocked(generateTokens).mockReturnValue({ accessToken: 'new-at', refreshToken: 'new-rt' });

      const req = { body: { refreshToken: 'valid-rt' } } as any;
      let sentBody: any = {};
      const setCookie = vi.fn();
      const reply = { send: (b: any) => { sentBody = b; return reply; }, setCookie, clearCookie: vi.fn() } as any;

      await AuthSessionController.refresh(req, reply);
      expect(sentBody.success).toBe(true);
      // Frontend khôi phục session sau F5 chỉ cần user — token mới nằm ở cookie.
      expect(sentBody.data.tokens).toBeUndefined();
      expect(setCookie).toHaveBeenCalledWith('access_token', 'new-at', expect.anything());
      expect(setCookie).toHaveBeenCalledWith('refresh_token', 'new-rt', expect.anything());
      expect(setCookie).toHaveBeenCalledTimes(2);
    });

    it('refresh của ADMIN nối luôn admin_token (cookie admin hết hạn sau 12h)', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(verifyRefreshToken).mockReturnValue({ userId: 'admin1' } as any);
      vi.mocked(UserRepository.findByIdWithSecurity).mockResolvedValue({ _id: 'admin1', role: 'ADMIN', passwordHash: '', email: '', username: '', status: 'active', createdAt: new Date() } as any);
      vi.mocked(generateTokens).mockReturnValue({ accessToken: 'new-at', refreshToken: 'new-rt' });

      const req = { body: { refreshToken: 'admin-rt' } } as any;
      const setCookie = vi.fn();
      const reply = { send: () => ({}), setCookie, clearCookie: vi.fn() } as any;

      await AuthSessionController.refresh(req, reply);
      expect(setCookie).toHaveBeenCalledWith('admin_token', 'new-at', expect.anything());
      expect(setCookie).toHaveBeenCalledTimes(3);
    });

    it('từ chối refresh khi mọi phiên đã bị thu hồi (đổi mật khẩu)', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(verifyRefreshToken).mockReturnValue({ userId: '123', iat: 1 } as any);
      vi.mocked(isSessionRevoked).mockResolvedValue(true);

      const req = { body: { refreshToken: 'old-rt' } } as any;
      const reply = { send: () => {}, setCookie: vi.fn(), clearCookie: vi.fn() } as any;
      await expect(AuthSessionController.refresh(req, reply)).rejects.toThrow('Phiên đăng nhập đã hết hạn');
      expect(UserRepository.findByIdWithSecurity).not.toHaveBeenCalled();
    });

    it('throws when refresh token is blacklisted', async () => {
      vi.mocked(redis.get).mockResolvedValue('1');
      const req = { body: { refreshToken: 'blacklisted-rt' } } as any;
      const reply = { send: () => {}, setCookie: vi.fn(), clearCookie: vi.fn() } as any;
      await expect(AuthSessionController.refresh(req, reply)).rejects.toThrow(UnauthorizedError);
    });

    it('throws when refresh token is missing', async () => {
      const req = { body: {} } as any;
      const reply = { send: () => {}, setCookie: vi.fn(), clearCookie: vi.fn() } as any;
      await expect(AuthSessionController.refresh(req, reply)).rejects.toThrow(UnauthorizedError);
    });

    it('blocks refresh for suspended accounts (admin lock takes effect immediately)', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(verifyRefreshToken).mockReturnValue({ userId: '123' } as any);
      vi.mocked(UserRepository.findByIdWithSecurity).mockResolvedValue({ _id: '123', role: 'USER', passwordHash: '', email: '', username: '', status: 'suspended', createdAt: new Date() } as any);

      const req = { body: { refreshToken: 'suspended-rt' } } as any;
      const reply = { send: () => {}, setCookie: vi.fn(), clearCookie: vi.fn() } as any;
      await expect(AuthSessionController.refresh(req, reply)).rejects.toThrow('Tài khoản của bạn đã bị khóa.');
    });

    // passwordChangedAt đã bị xóa, nên không còn test invalidate refresh token theo mốc đổi mật khẩu
  });

  describe('logout', () => {
    it('delegates to AuthSessionService.logout and returns success', async () => {
      vi.mocked(AuthSessionService.logout).mockResolvedValue(undefined);
      const req = { body: { refreshToken: 'rt-to-blacklist' } } as any;
      let sentBody: any = {};
      const reply = { send: (b: any) => { sentBody = b; return reply; }, setCookie: vi.fn(), clearCookie: vi.fn() } as any;

      await AuthSessionController.logout(req, reply);
      expect(AuthSessionService.logout).toHaveBeenCalledWith('rt-to-blacklist');
      expect(sentBody.success).toBe(true);
    });

    it('throws when refresh token is missing', async () => {
      const req = { body: {} } as any;
      const reply = { send: () => {}, setCookie: vi.fn(), clearCookie: vi.fn() } as any;
      await expect(AuthSessionController.logout(req, reply)).rejects.toThrow(UnauthorizedError);
    });
  });
});
