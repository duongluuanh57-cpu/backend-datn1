import { describe, it, expect, vi } from 'vitest';
import { AuthSessionController } from '../../controllers/auth/authSessionController.ts';
import { AuthSessionService } from '../../services/auth/authSessionService.ts';
import { AuthRegisterService } from '../../services/auth/authRegisterService.ts';
import { verifyTurnstile, verifyRefreshToken, generateTokens } from '../../utils/auth.ts';
import { redis } from '../../config/redis.ts';
import { UserRepository } from '../../repositories/UserRepository.ts';
import { UnauthorizedError } from '../../utils/errors.ts';

vi.mock('../../services/auth/authSessionService.ts', () => ({
  AuthSessionService: {
    login: vi.fn(),
    logout: vi.fn(),
  },
}));

vi.mock('../../services/auth/authRegisterService.ts', () => ({
  AuthRegisterService: {
    register: vi.fn(),
  },
}));

vi.mock('../../utils/auth.ts', () => ({
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

vi.mock('../../config/redis.ts', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('../../repositories/UserRepository.ts', () => ({
  UserRepository: {
    findById: vi.fn(),
    findByIdWithSecurity: vi.fn(),
    findByEmail: vi.fn(),
    findByUsername: vi.fn(),
    create: vi.fn(),
  },
}));

describe('AuthController - Register & Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyTurnstile).mockResolvedValue(undefined);
  });

  describe('register', () => {
    const validInput = {
      username: 'testuser',
      email: 'test@test.com',
      password: 'password123',
      turnstileToken: 'test-token',
    };

    it('should register user successfully', async () => {
      const mockUser: any = {
        _id: 'user123',
        username: 'testuser',
        email: 'test@test.com',
        role: 'USER',
        memberTier: 'MEMBER',
        status: 'active',
        fullName: '',
        phoneNumber: '',
        createdAt: new Date(),
      };

      const mockTokens = {
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-456',
      };

      vi.mocked(AuthRegisterService.register).mockResolvedValue({
        user: mockUser,
        tokens: mockTokens,
      });

      const req = { body: validInput } as any;
      let reply: any = {
        statusCode: 0,
        status(code: number) { reply.statusCode = code; return reply; },
        send(body: any) { reply.body = body; return reply; },
        header() { return reply; },
        setCookie: vi.fn().mockReturnThis(),
        clearCookie: vi.fn().mockReturnThis(),
      };

      await AuthSessionController.register(req, reply);

      expect(verifyTurnstile).toHaveBeenCalledWith('test-token', req.ip);
      expect(reply.statusCode).toBe(201);
      expect(reply.body.success).toBe(true);
      expect(reply.body.data.user.username).toBe('testuser');
    });

    it('should throw UnauthorizedError when turnstile verification fails', async () => {
      vi.mocked(verifyTurnstile).mockRejectedValue(new UnauthorizedError('Turnstile verification failed'));

      const req = { body: validInput } as any;
      const reply = { status: () => ({ send: () => {} }), setCookie: vi.fn(), clearCookie: vi.fn() } as any;

      await expect(AuthSessionController.register(req, reply)).rejects.toThrow(UnauthorizedError);
      expect(AuthSessionService.login).not.toHaveBeenCalled();
    });

    it('should return 201 with the user, session only in httpOnly cookies', async () => {
      const mockUser: any = {
        _id: 'user123',
        username: 'newuser',
        email: 'newuser@test.com',
        role: 'USER',
        memberTier: 'MEMBER',
        status: 'active',
        fullName: '',
        phoneNumber: '',
        createdAt: new Date(),
      };

      const mockTokens = {
        accessToken: 'access-token-789',
        refreshToken: 'refresh-token-012',
      };

      vi.mocked(AuthRegisterService.register).mockResolvedValue({
        user: mockUser,
        tokens: mockTokens,
      });

      const req = { body: validInput } as any;
      let reply: any = {
        statusCode: 0,
        status(code: number) { reply.statusCode = code; return reply; },
        send(body: any) { reply.body = body; return reply; },
        header() { return reply; },
        setCookie: vi.fn().mockReturnThis(),
        clearCookie: vi.fn().mockReturnThis(),
      };

      await AuthSessionController.register(req, reply);

      expect(reply.statusCode).toBe(201);
      expect(reply.body.success).toBe(true);
      expect(reply.body.data.user.username).toBe('newuser');
      // A5: body không còn mang token — session chỉ nằm ở cookie httpOnly.
      expect(reply.body.data.tokens).toBeUndefined();
      expect(reply.setCookie).toHaveBeenCalledWith('access_token', 'access-token-789', expect.anything());
      expect(reply.setCookie).toHaveBeenCalledWith('refresh_token', 'refresh-token-012', expect.anything());
    });

    it('should return 201 with user and tokens after login on registration success', async () => {
      const mockUser: any = {
        _id: 'user123',
        username: 'testuser',
        email: 'test@test.com',
        role: 'USER',
        memberTier: 'MEMBER',
        status: 'active',
        fullName: '',
        phoneNumber: '',
        createdAt: new Date(),
      };

      const mockTokens = {
        accessToken: 'access-token-999',
        refreshToken: 'refresh-token-888',
      };

      vi.mocked(AuthRegisterService.register).mockResolvedValue({
        user: mockUser,
        tokens: mockTokens,
      });

      const req = { body: { ...validInput, turnstileToken: 'test-register-token' } } as any;
      let reply: any = {
        statusCode: 0,
        status(code: number) { reply.statusCode = code; return reply; },
        send(body: any) { reply.body = body; return reply; },
        header() { return reply; },
        setCookie: vi.fn().mockReturnThis(),
        clearCookie: vi.fn().mockReturnThis(),
      };

      await AuthSessionController.register(req, reply);

      expect(reply.statusCode).toBe(201);
      expect(reply.body.success).toBe(true);
      expect(reply.body.data.user.username).toBe('testuser');
    });
  });

  describe('login', () => {
    const validLoginInput = {
      email: 'test@test.com',
      password: 'password123',
      turnstileToken: 'test-token',
    };

    it('should login user successfully', async () => {
      const mockUser: any = {
        _id: 'user123',
        username: 'testuser',
        email: 'test@test.com',
        role: 'USER',
        memberTier: 'MEMBER',
        status: 'active',
        fullName: '',
        phoneNumber: '',
        createdAt: new Date(),
      };

      const mockTokens = {
        accessToken: 'access-token-100',
        refreshToken: 'refresh-token-200',
      };

      vi.mocked(AuthSessionService.login).mockResolvedValue({
        user: mockUser,
        tokens: mockTokens,
      });

      const req = { body: validLoginInput, ip: '127.0.0.1', headers: { 'user-agent': 'vitest' } } as any;
      let reply: any = {
        statusCode: 200,
        status(code: number) { reply.statusCode = code; return reply; },
        send(body: any) { reply.body = body; return reply; },
        header() { return reply; },
        setCookie: vi.fn().mockReturnThis(),
        clearCookie: vi.fn().mockReturnThis(),
      };

      await AuthSessionController.login(req, reply);

      expect(verifyTurnstile).toHaveBeenCalledWith('test-token', req.ip);
      expect(reply.statusCode).toBe(200);
      expect(reply.body.success).toBe(true);
      expect(reply.body.data.user.username).toBe('testuser');
    });

    it('should throw UnauthorizedError when turnstile verification fails', async () => {
      vi.mocked(verifyTurnstile).mockRejectedValue(new UnauthorizedError('Turnstile verification failed'));

      const req = { body: validLoginInput } as any;
      const reply = { status: () => ({ send: () => {} }), setCookie: vi.fn(), clearCookie: vi.fn() } as any;

      await expect(AuthSessionController.login(req, reply)).rejects.toThrow(UnauthorizedError);
      expect(AuthSessionService.login).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedError on invalid credentials', async () => {
      vi.mocked(AuthSessionService.login).mockRejectedValue(new UnauthorizedError('Invalid credentials'));

      const req = { body: { email: 'wrong@test.com', password: 'wrongpass', turnstileToken: 'test-token' }, ip: '127.0.0.1', headers: {} } as any;
      const reply = { send: () => {}, header: () => {} } as any;

      await expect(AuthSessionController.login(req, reply)).rejects.toMatchObject({ statusCode: 401 });
    });

    it('should successfully login and set admin cookie for admin users', async () => {
      const adminMockUser: any = {
        _id: 'admin123',
        username: 'admin',
        email: 'admin@test.com',
        role: 'ADMIN',
        memberTier: 'ADMIN',
        status: 'active',
        fullName: '',
        phoneNumber: '',
        createdAt: new Date(),
      };

      const mockTokens = {
        accessToken: 'admin-access-token-888',
        refreshToken: 'admin-refresh-token-999',
      };

      vi.mocked(AuthSessionService.login).mockResolvedValue({
        user: adminMockUser,
        tokens: mockTokens,
      });

      const req = { body: validLoginInput, ip: '127.0.0.1', headers: { 'user-agent': 'vitest' } } as any;
      const setCookie = vi.fn();
      const reply: any = {
        statusCode: 200,
        status(code: number) { reply.statusCode = code; return reply; },
        send(body: any) { reply.body = body; return reply; },
        setCookie,
      };

      await AuthSessionController.login(req, reply);

      expect(reply.statusCode).toBe(200);
      expect(reply.body.success).toBe(true);
      expect(reply.body.data.user.username).toBe('admin');
      // Cookie admin phải đi qua setCookie với đúng bộ attributes cross-site (không còn
      // tự ghép chuỗi "SameSite=Lax" thủ công — Lax làm cookie chết trên FE Vercel).
      expect(setCookie).toHaveBeenCalledWith(
        'admin_token',
        'admin-access-token-888',
        expect.objectContaining({ httpOnly: true, path: '/', maxAge: 12 * 60 * 60 })
      );
      // ADMIN nhận đủ 3 cookie: access + refresh (phiên user, để restoreSession()/
      // /api/auth/me chạy được) và admin_token (route /admin/*).
      expect(setCookie).toHaveBeenCalledWith(
        'access_token',
        'admin-access-token-888',
        expect.objectContaining({ httpOnly: true, path: '/' })
      );
      expect(setCookie).toHaveBeenCalledWith(
        'refresh_token',
        'admin-refresh-token-999',
        expect.objectContaining({ httpOnly: true, path: '/' })
      );
      expect(setCookie).toHaveBeenCalledTimes(3);
    });

    it('should login with username instead of email', async () => {
      const mockUser: any = {
        _id: 'user123',
        username: 'testuser',
        email: 'test@test.com',
        role: 'USER',
        memberTier: 'MEMBER',
        status: 'active',
        fullName: '',
        phoneNumber: '',
        createdAt: new Date(),
      };

      vi.mocked(AuthSessionService.login).mockResolvedValue({
        user: mockUser,
        tokens: { accessToken: 'access-token-user', refreshToken: 'refresh-token-user' },
      });

      const req = { body: { email: 'testuser', password: 'password123', turnstileToken: 'test-token' }, ip: '127.0.0.1', headers: { 'user-agent': 'vitest' } } as any;
      let reply: any = {
        statusCode: 200,
        status(code: number) { reply.statusCode = code; return reply; },
        send(body: any) { reply.body = body; return reply; },
        header() { return reply; },
        setCookie: vi.fn().mockReturnThis(),
        clearCookie: vi.fn().mockReturnThis(),
      };

      await AuthSessionController.login(req, reply);

      expect(verifyTurnstile).toHaveBeenCalledWith('test-token', req.ip);
      expect(reply.statusCode).toBe(200);
      expect(reply.body.success).toBe(true);
    });
  });

  describe('refresh', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(verifyTurnstile).mockResolvedValue(undefined);
      vi.mocked(UserRepository.findByIdWithSecurity).mockResolvedValue({
        _id: 'user123',
        username: 'testuser',
        email: 'test@test.com',
        role: 'USER',
        passwordHash: 'hash',
        status: 'active',
        fullName: '',
        phoneNumber: '',
        createdAt: new Date(),
      } as any);
    });

    const validRefreshInput = {
      refreshToken: 'valid-refresh-token-123',
    };

    it('should refresh token successfully', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(verifyRefreshToken).mockReturnValue({ userId: 'user123' });
      vi.mocked(generateTokens).mockReturnValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });

      const req = { body: validRefreshInput } as any;
      const setCookie = vi.fn();
      let reply: any = {
        send: (body: any) => { reply = body; return reply; },
        setCookie,
        clearCookie: vi.fn(),
      };

      await AuthSessionController.refresh(req, reply);

      expect(reply.success).toBe(true);
      // Cặp token mới chỉ đi qua httpOnly cookie; body trả user để FE khôi phục session sau F5.
      expect(reply.data.tokens).toBeUndefined();
      expect(reply.data.user).toBeDefined();
      expect(setCookie).toHaveBeenCalledWith('access_token', 'new-access-token', expect.anything());
      expect(setCookie).toHaveBeenCalledWith('refresh_token', 'new-refresh-token', expect.anything());
    });

    it('should throw UnauthorizedError when refresh token is blacklisted', async () => {
      vi.mocked(redis.get).mockResolvedValue('1');

      const req = { body: { refreshToken: 'blacklisted-refresh-token' } } as any;
      const reply = { send: () => {}, setCookie: vi.fn(), clearCookie: vi.fn() } as any;

      await expect(AuthSessionController.refresh(req, reply)).rejects.toThrow(UnauthorizedError);
    });

    it('should throw UnauthorizedError when refresh token is missing', async () => {
      const req = { body: {} } as any;
      const reply = { send: () => {}, setCookie: vi.fn(), clearCookie: vi.fn() } as any;

      await expect(AuthSessionController.refresh(req, reply)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('logout', () => {
    const validLogoutInput = {
      refreshToken: 'logout-refresh-token-123',
    };

    it('should logout successfully', async () => {
      const req = { body: validLogoutInput } as any;
      let reply: any = {
        send: (body: any) => { reply = body; return reply; },
        setCookie: vi.fn(),
        clearCookie: vi.fn(),
      };

      await AuthSessionController.logout(req, reply);

      expect(reply.success).toBe(true);
    });

    it('should throw UnauthorizedError when refresh token is missing', async () => {
      const req = { body: {} } as any;
      const reply = { send: () => {}, setCookie: vi.fn(), clearCookie: vi.fn() } as any;

      await expect(AuthSessionController.logout(req, reply)).rejects.toThrow(UnauthorizedError);
    });
  });
});