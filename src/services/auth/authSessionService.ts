import { UserRepository } from '../../repositories/UserRepository.ts';
import type { LoginInput } from '../../types/user.types.ts';
import {
  comparePassword,
  generateTokens,
  toPublicUser,
  verifyRefreshToken,
  refreshTokenBlacklistKey,
  REFRESH_TOKEN_TTL_SECONDS,
} from '../../utils/auth.ts';
import { UnauthorizedError } from '../../utils/errors.ts';
import { redis } from '../../config/redis.ts';

/** Chuẩn hóa identifier: trim + lowercase (email và username lưu lowercase từ khi tạo) */
const normalizeIdentifier = (raw: string) => (raw || '').trim().toLowerCase();

export class AuthSessionService {
  static async login(data: LoginInput) {
    const identifier = normalizeIdentifier(data.email);

    const isEmail = identifier.includes('@');

    const user = isEmail
      ? await UserRepository.findByEmail(identifier)
      : await UserRepository.findByUsername(identifier);

    if (!user) throw new UnauthorizedError('Email, tên đăng nhập hoặc mật khẩu không chính xác');

    if (user.status !== 'active') {
      throw new UnauthorizedError(
        user.status === 'suspended'
          ? 'Tài khoản của bạn đã bị khóa.'
          : 'Tài khoản của bạn không khả dụng.',
      );
    }

    const isMatch = await comparePassword(data.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedError('Email, tên đăng nhập hoặc mật khẩu không chính xác');
    }

    const tokens = generateTokens(user._id.toString(), user.role);

    return {
      user: toPublicUser(user),
      tokens
    };
  }

  static async logout(refreshToken: string) {
    if (!refreshToken) throw new UnauthorizedError('Refresh token là bắt buộc');

    // Xác minh token hợp lệ trước khi blacklist — chặn người lạ ném token bừa vào blacklist,
    // và lấy jti để blacklist đúng cách rotation thay vì theo giá trị token.
    let jti: string | undefined;
    try {
      ({ jti } = verifyRefreshToken(refreshToken));
    } catch {
      throw new UnauthorizedError('Refresh token không hợp lệ');
    }

    await redis.set(
      refreshTokenBlacklistKey(refreshToken, jti),
      '1',
      'EX',
      REFRESH_TOKEN_TTL_SECONDS
    );
  }
}
