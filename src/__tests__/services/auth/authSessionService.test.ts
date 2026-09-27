import { describe, it, expect, vi } from 'vitest';
import { AuthSessionService } from '../../../services/auth/authSessionService.ts';
import { UnauthorizedError } from '../../../utils/errors.ts';

vi.mock('../../../repositories/UserRepository.ts', () => ({
  UserRepository: {
    findByEmail: vi.fn(),
    findByUsername: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../../../utils/auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/auth.ts')>()),
  comparePassword: vi.fn(),
  generateTokens: vi.fn(),
  verifyRefreshToken: vi.fn(),
}));

vi.mock('../../../config/redis.ts', () => ({
  redis: { set: vi.fn() },
}));

import { UserRepository } from '../../../repositories/UserRepository.ts';
import { comparePassword, generateTokens, verifyRefreshToken } from '../../../utils/auth.ts';
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
    it('throws UnauthorizedError when user not found', async () => {
      vi.mocked(UserRepository.findByEmail).mockResolvedValue(null);
      await expect(AuthSessionService.login({ email: 'unknown@test.com', password: 'x' }))
        .rejects.toThrow(UnauthorizedError)
        .then(() => expect(comparePassword).not.toHaveBeenCalled());
    });

    it('normalizes identifier: trims and lowercases before lookup', async () => {
      vi.mocked(UserRepository.findByEmail).mockResolvedValue(mockUser);
      vi.mocked(comparePassword).mockResolvedValue(true);
      vi.mocked(generateTokens).mockReturnValue(mockTokens);

      await AuthSessionService.login({ email: '  Test@Test.COM ', password: 'correct' });

      expect(UserRepository.findByEmail).toHaveBeenCalledWith('test@test.com');
    });

    it('finds user by username when identifier has no @', async () => {
      vi.mocked(UserRepository.findByUsername).mockResolvedValue(mockUser);
      vi.mocked(comparePassword).mockResolvedValue(true);
      vi.mocked(generateTokens).mockReturnValue(mockTokens);

      const result = await AuthSessionService.login({ email: 'TestUser', password: 'correct' });

      expect(UserRepository.findByUsername).toHaveBeenCalledWith('testuser');
      expect(UserRepository.findByEmail).not.toHaveBeenCalled();
      expect(result.user.username).toBe('testuser');
    });

    it('throws UnauthorizedError when username not found', async () => {
      vi.mocked(UserRepository.findByUsername).mockResolvedValue(null);
      await expect(AuthSessionService.login({ email: 'unknown_user', password: 'x' }))
        .rejects.toThrow(UnauthorizedError)
        .then(() => expect(comparePassword).not.toHaveBeenCalled());
    });

    it('throws UnauthorizedError when account is suspended', async () => {
      vi.mocked(UserRepository.findByEmail).mockResolvedValue({ ...mockUser, status: 'suspended' });
      await expect(AuthSessionService.login({ email: 'test@test.com', password: 'x' }))
        .rejects.toThrow('Tài khoản của bạn đã bị khóa.');

      expect(comparePassword).not.toHaveBeenCalled();
    });

    it('rejects invalid password (no lockout mechanism)', async () => {
      vi.mocked(UserRepository.findByEmail).mockResolvedValue(mockUser);
      vi.mocked(comparePassword).mockResolvedValue(false);

      await expect(AuthSessionService.login({ email: 'test@test.com', password: 'x' }))
        .rejects.toThrow(UnauthorizedError);
    });

    it('returns user with fullName and phoneNumber defaults', async () => {
      vi.mocked(UserRepository.findByEmail).mockResolvedValue(mockUser);
      vi.mocked(comparePassword).mockResolvedValue(true);
      vi.mocked(generateTokens).mockReturnValue(mockTokens);

      const result = await AuthSessionService.login({ email: 'test@test.com', password: 'correct' });

      expect(result.user.fullName).toBe('');
      expect(result.user.phoneNumber).toBe('');
    });
  });

  describe('logout', () => {
    it('blacklists refresh token in Redis by jti', async () => {
      vi.mocked(verifyRefreshToken).mockReturnValue({ userId: 'user-123', jti: 'jti-abc' } as any);
      vi.mocked(redis.set).mockResolvedValue('OK' as any);

      await AuthSessionService.logout('refresh-token-123');

      expect(verifyRefreshToken).toHaveBeenCalledWith('refresh-token-123');
      expect(redis.set).toHaveBeenCalledWith('blacklist:jti:jti-abc', '1', 'EX', 604800);
    });

    it('rejects invalid refresh token without blacklisting', async () => {
      vi.mocked(verifyRefreshToken).mockImplementation(() => {
        throw new Error('jwt malformed');
      });

      await expect(AuthSessionService.logout('garbage-token'))
        .rejects.toThrow(UnauthorizedError);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedError when refreshToken is missing', async () => {
      await expect(AuthSessionService.logout('')).rejects.toThrow(UnauthorizedError);
      expect(redis.set).not.toHaveBeenCalled();
    });
  });
});
