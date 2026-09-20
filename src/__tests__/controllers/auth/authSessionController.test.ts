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
import { verifyTurnstile, verifyRefreshToken, generateTokens } from '../../../utils/auth.ts';
import { redis } from '../../../config/redis.ts';
import { UserRepository } from '../../../repositories/UserRepository.ts';

describe('AuthSessionController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyTurnstile).mockResolvedValue(undefined);
  });

  describe('login', () => {
    it('returns tokens on successful login', async () => {
      const mockResult: any = {
        user: { id: '123', username: 'test', role: 'USER' },
        tokens: { accessToken: 'at', refreshToken: 'rt' },
      };
      vi.mocked(AuthSessionService.login).mockResolvedValue(mockResult);

      const req = { body: { email: 'a@b.com', password: 'pwd' }, ip: '1.2.3.4', headers: { 'user-agent': 'test' } } as any;
      let sentBody: any = {};
      const reply = { send: (b: any) => { sentBody = b; return reply; }, status: () => reply, header: () => reply, setCookie: vi.fn(), clearCookie: vi.fn() } as any;

      await AuthSessionController.login(req, reply);
      expect(sentBody.success).toBe(true);
      expect(sentBody.data).toEqual({
        user: mockResult.user,
        tokens: mockResult.tokens,
      });
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
      const reply = {
        status: (c: number) => { statusCode = c; return { send: (b: any) => { sentBody = b; } }; },
        setCookie: vi.fn(),
        clearCookie: vi.fn(),
      } as any;

      await AuthSessionController.register(req, reply);
      expect(statusCode).toBe(201);
      expect(sentBody.success).toBe(true);
      expect(sentBody.data).toEqual({
        user: mockResult.user,
        tokens: mockResult.tokens,
      });
    });
  });

  describe('refresh', () => {
    it('returns new tokens on valid refresh token', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(verifyRefreshToken).mockReturnValue({ userId: '123' } as any);
      vi.mocked(UserRepository.findByIdWithSecurity).mockResolvedValue({ _id: '123', role: 'USER', passwordHash: '', email: '', username: '', status: 'active', createdAt: new Date(), passwordChangedAt: null } as any);
      vi.mocked(generateTokens).mockReturnValue({ accessToken: 'new-at', refreshToken: 'new-rt' });

      const req = { body: { refreshToken: 'valid-rt' } } as any;
      let sentBody: any = {};
      const reply = { send: (b: any) => { sentBody = b; return reply; }, setCookie: vi.fn(), clearCookie: vi.fn() } as any;

      await AuthSessionController.refresh(req, reply);
      expect(sentBody.success).toBe(true);
      expect(sentBody.data.tokens.accessToken).toBe('new-at');
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
      vi.mocked(UserRepository.findByIdWithSecurity).mockResolvedValue({ _id: '123', role: 'USER', passwordHash: '', email: '', username: '', status: 'suspended', createdAt: new Date(), passwordChangedAt: null } as any);

      const req = { body: { refreshToken: 'suspended-rt' } } as any;
      const reply = { send: () => {}, setCookie: vi.fn(), clearCookie: vi.fn() } as any;
      await expect(AuthSessionController.refresh(req, reply)).rejects.toThrow('tạm khóa');
    });

    it('blocks refresh tokens issued before the last password change', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(verifyRefreshToken).mockReturnValue({ userId: '123', iat: 1000000000 } as any);
      vi.mocked(UserRepository.findByIdWithSecurity).mockResolvedValue({ _id: '123', role: 'USER', passwordHash: '', email: '', username: '', status: 'active', createdAt: new Date(), passwordChangedAt: new Date('2020-01-01T00:00:00Z') } as any);

      const req = { body: { refreshToken: 'pre-change-rt' } } as any;
      const reply = { send: () => {}, setCookie: vi.fn(), clearCookie: vi.fn() } as any;
      await expect(AuthSessionController.refresh(req, reply)).rejects.toThrow('đăng nhập lại');
    });
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
