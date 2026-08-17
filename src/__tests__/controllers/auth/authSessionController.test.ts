import { describe, it, expect, vi } from 'vitest';
import { AuthSessionController } from '../../../controllers/auth/authSessionController.ts';
import { UnauthorizedError } from '../../../utils/errors.ts';

vi.mock('../../../services/AuthService.ts', () => ({
  AuthService: {
    register: vi.fn(),
    login: vi.fn(),
  },
}));

vi.mock('../../../utils/auth.ts', () => ({
  verifyAccessToken: vi.fn(),
  verifyRefreshToken: vi.fn(),
  generateTokens: vi.fn(),
}));

vi.mock('../../../config/redis.ts', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('../../../repositories/UserRepository.ts', () => ({
  UserRepository: { findById: vi.fn() },
}));

import { AuthService } from '../../../services/AuthService.ts';
import { verifyAccessToken, verifyRefreshToken, generateTokens } from '../../../utils/auth.ts';
import { redis } from '../../../config/redis.ts';
import { UserRepository } from '../../../repositories/UserRepository.ts';

describe('AuthSessionController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('login', () => {
    it('returns tokens on successful login', async () => {
      const mockResult: any = {
        user: { id: '123', username: 'test', role: 'USER' },
        tokens: { accessToken: 'at', refreshToken: 'rt' },
      };
      vi.mocked(AuthService.login).mockResolvedValue(mockResult);

      const req = { body: { email: 'a@b.com', password: 'pwd' }, ip: '1.2.3.4', headers: { 'user-agent': 'test' } } as any;
      let sentBody: any = {};
      const reply = { send: (b: any) => { sentBody = b; return reply; }, status: () => reply } as any;

      await AuthSessionController.login(req, reply);
      expect(sentBody.success).toBe(true);
      expect(sentBody.data).toEqual(mockResult);
    });

    it('throws when AuthService.login fails', async () => {
      vi.mocked(AuthService.login).mockRejectedValue(new Error('Bad credentials'));
      const req = { body: { email: 'a@b.com', password: 'x' }, ip: '1.2.3.4', headers: {} } as any;
      const reply = { send: () => {}, status: () => reply } as any;
      await expect(AuthSessionController.login(req, reply)).rejects.toThrow('Bad credentials');
    });
  });

  describe('register', () => {
    it('returns 201 with user data on success', async () => {
      const mockUser: any = { id: '123', username: 'newuser' };
      vi.mocked(AuthService.register).mockResolvedValue(mockUser);

      const req = { body: { username: 'newuser', email: 'a@b.com', password: 'pwd' } } as any;
      let statusCode = 0, sentBody: any = {};
      const reply = {
        status: (c: number) => { statusCode = c; return { send: (b: any) => { sentBody = b; } }; },
      } as any;

      await AuthSessionController.register(req, reply);
      expect(statusCode).toBe(201);
      expect(sentBody.success).toBe(true);
      expect(sentBody.data).toEqual(mockUser);
    });
  });

  describe('refresh', () => {
    it('returns new tokens on valid refresh token', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(verifyRefreshToken).mockReturnValue({ userId: '123' } as any);
      vi.mocked(UserRepository.findById).mockResolvedValue({ _id: '123', role: 'USER', passwordHash: '', email: '', username: '', status: 'active', createdAt: new Date() } as any);
      vi.mocked(generateTokens).mockReturnValue({ accessToken: 'new-at', refreshToken: 'new-rt' });

      const req = { body: { refreshToken: 'valid-rt' } } as any;
      let sentBody: any = {};
      const reply = { send: (b: any) => { sentBody = b; return reply; } } as any;

      await AuthSessionController.refresh(req, reply);
      expect(sentBody.success).toBe(true);
      expect(sentBody.data.accessToken).toBe('new-at');
    });

    it('throws when refresh token is blacklisted', async () => {
      vi.mocked(redis.get).mockResolvedValue('1');
      const req = { body: { refreshToken: 'blacklisted-rt' } } as any;
      const reply = { send: () => {} } as any;
      await expect(AuthSessionController.refresh(req, reply)).rejects.toThrow(UnauthorizedError);
    });

    it('throws when refresh token is missing', async () => {
      const req = { body: {} } as any;
      const reply = { send: () => {} } as any;
      await expect(AuthSessionController.refresh(req, reply)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('setAdminSession', () => {
    it('redirects to /admin when token is valid admin', async () => {
      vi.mocked(verifyAccessToken).mockReturnValue({ userId: '123', role: 'ADMIN' } as any);
      const req = { query: { token: 'valid-admin-token' } } as any;
      let redirectUrl = '', setCookie = '';
      const reply = {
        redirect: (u: string) => { redirectUrl = u; return reply; },
        header: (n: string, v: string) => { setCookie = v; return reply; },
      } as any;

      await AuthSessionController.setAdminSession(req, reply);
      expect(redirectUrl).toBe('/admin');
      expect(setCookie).toContain('admin_token=');
    });

    it('redirects to login when no token provided', async () => {
      const req = { query: {} } as any;
      let redirectUrl = '';
      const reply = { redirect: (u: string) => { redirectUrl = u; return reply; }, header: () => reply } as any;

      await AuthSessionController.setAdminSession(req, reply);
      expect(redirectUrl).toBe('/login');
    });

    it('redirects to login when role is not ADMIN', async () => {
      vi.mocked(verifyAccessToken).mockReturnValue({ userId: '123', role: 'USER' } as any);
      const req = { query: { token: 'user-token' } } as any;
      let redirectUrl = '';
      const reply = { redirect: (u: string) => { redirectUrl = u; return reply; }, header: () => reply } as any;

      await AuthSessionController.setAdminSession(req, reply);
      expect(redirectUrl).toBe('/login');
    });

    it('redirects to login on invalid token', async () => {
      vi.mocked(verifyAccessToken).mockImplementation(() => { throw new Error('Invalid'); });
      const req = { query: { token: 'bad-token' } } as any;
      let redirectUrl = '';
      const reply = { redirect: (u: string) => { redirectUrl = u; return reply; }, header: () => reply } as any;

      await AuthSessionController.setAdminSession(req, reply);
      expect(redirectUrl).toBe('/login');
    });
  });

  describe('logout', () => {
    it('blacklists token and returns success', async () => {
      vi.mocked(redis.set).mockResolvedValue('OK' as any);
      const req = { body: { refreshToken: 'rt-to-blacklist' } } as any;
      let sentBody: any = {};
      const reply = { send: (b: any) => { sentBody = b; return reply; } } as any;

      await AuthSessionController.logout(req, reply);
      expect(redis.set).toHaveBeenCalledWith('blacklist:rt-to-blacklist', '1', 'EX', 604800);
      expect(sentBody.success).toBe(true);
    });

    it('throws when refresh token is missing', async () => {
      const req = { body: {} } as any;
      const reply = { send: () => {} } as any;
      await expect(AuthSessionController.logout(req, reply)).rejects.toThrow(UnauthorizedError);
    });
  });
});
