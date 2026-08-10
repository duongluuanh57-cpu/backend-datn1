import { describe, it, expect, vi } from 'vitest';
import { AuthSessionService } from '../../../services/auth/authSessionService.ts';
import { UnauthorizedError } from '../../../utils/errors.ts';

vi.mock('../../../repositories/UserRepository.ts', () => ({
  UserRepository: {
    findByEmail: vi.fn(),
    findByUsername: vi.fn(),
  },
}));

vi.mock('../../../utils/auth.ts', () => ({
  comparePassword: vi.fn(),
  generateTokens: vi.fn(),
}));

vi.mock('../../../models/AuditLog.ts', () => ({
  AuditLog: { create: vi.fn() },
}));

vi.mock('../../../config/redis.ts', () => ({
  redis: { set: vi.fn() },
}));

import { UserRepository } from '../../../repositories/UserRepository.ts';
import { comparePassword, generateTokens } from '../../../utils/auth.ts';
import { AuditLog } from '../../../models/AuditLog.ts';
import { redis } from '../../../config/redis.ts';

const mockUser: any = {
  _id: '507f1f77bcf86cd799439011',
  username: 'testuser',
  email: 'test@test.com',
  role: 'USER',
  passwordHash: '$2a$10$hashedpassword',
  status: 'active',
  memberTier: 'MEMBER',
  createdAt: new Date('2025-01-01'),
};

const mockTokens = {
  accessToken: 'access-token-123',
  refreshToken: 'refresh-token-456',
};

describe('AuthSessionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('login', () => {
    const metadata = { ip: '127.0.0.1', userAgent: 'vitest' };

    it('throws UnauthorizedError when user not found', async () => {
      vi.mocked(UserRepository.findByEmail).mockResolvedValue(null);
      await expect(AuthSessionService.login({ email: 'unknown@test.com', password: 'x' }, metadata))
        .rejects.toThrow(UnauthorizedError);
      expect(comparePassword).not.toHaveBeenCalled();
    });

    it('finds user by username when identifier has no @', async () => {
      vi.mocked(UserRepository.findByUsername).mockResolvedValue(mockUser);
      vi.mocked(comparePassword).mockResolvedValue(true);
      vi.mocked(generateTokens).mockReturnValue(mockTokens);

      const result = await AuthSessionService.login({ email: 'testuser', password: 'correct' }, metadata);

      expect(UserRepository.findByUsername).toHaveBeenCalledWith('testuser');
      expect(UserRepository.findByEmail).not.toHaveBeenCalled();
      expect(result.user.username).toBe('testuser');
    });

    it('throws UnauthorizedError when username not found', async () => {
      vi.mocked(UserRepository.findByUsername).mockResolvedValue(null);
      await expect(AuthSessionService.login({ email: 'unknown_user', password: 'x' }, metadata))
        .rejects.toThrow(UnauthorizedError);
      expect(comparePassword).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedError when account is suspended', async () => {
      vi.mocked(UserRepository.findByEmail).mockResolvedValue({ ...mockUser, status: 'suspended' });
      await expect(AuthSessionService.login({ email: 'test@test.com', password: 'x' }, metadata))
        .rejects.toThrow(UnauthorizedError);
      expect(comparePassword).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedError when account is inactive', async () => {
      vi.mocked(UserRepository.findByEmail).mockResolvedValue({ ...mockUser, status: 'inactive' });
      await expect(AuthSessionService.login({ email: 'test@test.com', password: 'x' }, metadata))
        .rejects.toThrow(UnauthorizedError);
    });

    it('throws UnauthorizedError on wrong password and creates audit log', async () => {
      vi.mocked(UserRepository.findByEmail).mockResolvedValue(mockUser);
      vi.mocked(comparePassword).mockResolvedValue(false);

      await expect(AuthSessionService.login({ email: 'test@test.com', password: 'wrong' }, metadata))
        .rejects.toThrow(UnauthorizedError);

      expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: mockUser._id,
        action: 'LOGIN',
        status: 'FAILURE',
      }));
    });

    it('returns user and tokens on successful login', async () => {
      vi.mocked(UserRepository.findByEmail).mockResolvedValue(mockUser);
      vi.mocked(comparePassword).mockResolvedValue(true);
      vi.mocked(generateTokens).mockReturnValue(mockTokens);

      const result = await AuthSessionService.login({ email: 'test@test.com', password: 'correct' }, metadata);

      expect(result.user.id).toBe(mockUser._id);
      expect(result.user.role).toBe('USER');
      expect(result.tokens).toEqual(mockTokens);
      expect(redis.set).toHaveBeenCalled();
      expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        action: 'LOGIN',
        status: 'SUCCESS',
      }));
    });

    it('stores session in Redis with 15min TTL by default', async () => {
      vi.mocked(UserRepository.findByEmail).mockResolvedValue(mockUser);
      vi.mocked(comparePassword).mockResolvedValue(true);
      vi.mocked(generateTokens).mockReturnValue(mockTokens);

      await AuthSessionService.login({ email: 'test@test.com', password: 'correct' }, metadata);

      expect(redis.set).toHaveBeenCalledWith(
        `session:${mockUser._id}:${metadata.ip}`,
        expect.any(String),
        'EX',
        900,
      );
    });

    it('stores session with 7day TTL when rememberMe is true', async () => {
      vi.mocked(UserRepository.findByEmail).mockResolvedValue(mockUser);
      vi.mocked(comparePassword).mockResolvedValue(true);
      vi.mocked(generateTokens).mockReturnValue(mockTokens);

      await AuthSessionService.login({ email: 'test@test.com', password: 'correct', rememberMe: true }, metadata);

      expect(redis.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'EX',
        604800,
      );
    });

    it('returns user with fullName and phoneNumber defaults', async () => {
      vi.mocked(UserRepository.findByEmail).mockResolvedValue(mockUser);
      vi.mocked(comparePassword).mockResolvedValue(true);
      vi.mocked(generateTokens).mockReturnValue(mockTokens);

      const result = await AuthSessionService.login({ email: 'test@test.com', password: 'correct' }, metadata);

      expect(result.user.fullName).toBe('');
      expect(result.user.phoneNumber).toBe('');
    });
  });

  describe('logout', () => {
    it('blacklists refresh token in Redis', async () => {
      vi.mocked(redis.set).mockResolvedValue('OK' as any);
      vi.mocked(AuditLog.create).mockResolvedValue({} as any);

      const result = await AuthSessionService.logout('refresh-token-123', 'user-123');

      expect(redis.set).toHaveBeenCalledWith('blacklist:refresh-token-123', 'true', 'EX', 604800);
      expect(result.success).toBe(true);
    });

    it('creates audit log on logout', async () => {
      vi.mocked(redis.set).mockResolvedValue('OK' as any);
      vi.mocked(AuditLog.create).mockResolvedValue({} as any);

      await AuthSessionService.logout('refresh-token-123', 'user-123');

      expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-123',
        action: 'LOGOUT',
        status: 'SUCCESS',
      }));
    });
  });
});
