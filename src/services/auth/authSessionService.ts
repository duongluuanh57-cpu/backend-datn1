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
import { AuditLog } from '../../models/AuditLog.ts';
import { redis } from '../../config/redis.ts';

// ── Cấu hình khóa tài khoản (lockout) ──
const MAX_FAILED_ATTEMPTS = 5;    // Sai quá 5 lần liên tiếp
const LOCK_MINUTES = 15;          // → khóa 15 phút

/** Chuẩn hóa identifier: trim + lowercase (email và username lưu lowercase từ khi tạo) */
const normalizeIdentifier = (raw: string) => (raw || '').trim().toLowerCase();

export class AuthSessionService {
  static async login(data: LoginInput, metadata: { ip: string, userAgent: string }) {
    const identifier = normalizeIdentifier(data.email);

    const isEmail = identifier.includes('@');

    const user = isEmail
      ? await UserRepository.findByEmail(identifier)
      : await UserRepository.findByUsername(identifier);

    if (!user) throw new UnauthorizedError('Email, tên đăng nhập hoặc mật khẩu không chính xác');

    if (user.status === 'suspended') {
      throw new UnauthorizedError('Tài khoản của bạn đã bị tạm khóa. Vui lòng liên hệ quản trị viên.');
    }

    if (user.status === 'inactive') {
      throw new UnauthorizedError('Tài khoản của bạn chưa được kích hoạt.');
    }

    // ── Khóa tài khoản tạm thời khi sai mật khẩu nhiều lần (lockout) ──
    const lockUntil = (user as any).lockUntil ? new Date((user as any).lockUntil) : null;
    if (lockUntil && lockUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((lockUntil.getTime() - Date.now()) / 60000);
      throw new UnauthorizedError(
        `Tài khoản tạm khóa do nhập sai mật khẩu quá ${MAX_FAILED_ATTEMPTS} lần. Thử lại sau ${minutes} phút.`
      );
    }

    const isMatch = await comparePassword(data.password, user.passwordHash);
    if (!isMatch) {
      const failed = ((user as any).failedLoginAttempts || 0) + 1;
      const shouldLock = failed >= MAX_FAILED_ATTEMPTS;
      const update: any = {
        failedLoginAttempts: shouldLock ? 0 : failed,
      };
      if (shouldLock) {
        update.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
      }
      await UserRepository.update(String(user._id), update);
      await AuditLog.create({
        userId: user._id,
        action: 'LOGIN',
        resource: 'User',
        metadata,
        status: 'FAILURE'
      });
      throw new UnauthorizedError('Email, tên đăng nhập hoặc mật khẩu không chính xác');
    }

    // Đăng nhập thành công → reset bộ đếm + xóa khóa
    await UserRepository.update(String(user._id), {
      failedLoginAttempts: 0,
      lockUntil: null,
    });

    await AuditLog.create({
      userId: user._id,
      action: 'LOGIN',
      resource: 'User',
      metadata,
      status: 'SUCCESS'
    });

    const tokens = generateTokens(user._id.toString(), user.role);

    return {
      user: toPublicUser(user),
      tokens
    };
  }

  static async logout(refreshToken: string, userId?: string) {
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

    await AuditLog.create({
      userId,
      action: 'LOGOUT',
      resource: 'User',
      status: 'SUCCESS'
    });
  }
}
