import { UserRepository } from '../../repositories/UserRepository.ts';
import type { LoginInput } from '../../types/user.types.ts';
import { comparePassword, generateTokens } from '../../utils/auth.ts';
import { UnauthorizedError } from '../../utils/errors.ts';
import { AuditLog } from '../../models/AuditLog.ts';
import { redis } from '../../config/redis.ts';

export class AuthSessionService {
  static async login(data: LoginInput & { rememberMe?: boolean }, metadata: { ip: string, userAgent: string }) {
    // 1. Tìm user theo email hoặc tên đăng nhập
    const identifier = (data.email || '').trim();
    const isEmail = identifier.includes('@');
    const user = isEmail
      ? await UserRepository.findByEmail(identifier)
      : await UserRepository.findByUsername(identifier);
    if (!user) throw new UnauthorizedError('Email, tên đăng nhập hoặc mật khẩu không chính xác');

    // Kiểm tra trạng thái tài khoản (Bảo mật 2026)
    if (user.status === 'suspended') {
      throw new UnauthorizedError('Tài khoản của bạn đã bị tạm khóa. Vui lòng liên hệ quản trị viên.');
    }
    if (user.status === 'inactive') {
      throw new UnauthorizedError('Tài khoản của bạn chưa được kích hoạt.');
    }

    // 2. Đối chiếu mật khẩu
    const isMatch = await comparePassword(data.password, user.passwordHash);
    if (!isMatch) {
      await AuditLog.create({
        userId: user._id,
        action: 'LOGIN',
        resource: 'User',
        metadata: { ...metadata },
        status: 'FAILURE'
      });
      throw new UnauthorizedError('Email, tên đăng nhập hoặc mật khẩu không chính xác');
    }

    // 3. Session Hardening: Lưu thông tin session vào Redis
    const sessionTTL = data.rememberMe ? 60 * 60 * 24 * 7 : 900; // 7 days or 15 mins
    await redis.set(`session:${user._id}:${metadata.ip}`, JSON.stringify({
      userAgent: metadata.userAgent,
      lastLogin: new Date().toISOString(),
      rememberMe: data.rememberMe
    }), 'EX', sessionTTL);

    // 4. Audit Logging
    await AuditLog.create({
      userId: user._id,
      action: 'LOGIN',
      resource: 'User',
      metadata: { ...metadata, rememberMe: data.rememberMe },
      status: 'SUCCESS'
    });

    // 5. Sinh bộ đôi Token
    const tokens = generateTokens(user._id.toString(), user.role, data.rememberMe);

    return {
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        memberTier: (user as any).memberTier || 'MEMBER',
        status: (user as any).status || 'active',
        fullName: (user as any).fullName || '',
        phoneNumber: (user as any).phoneNumber || '',
        gender: (user as any).gender || '',
        createdAt: user.createdAt
      },
      tokens
    };
  }

  /**
   * Đăng xuất & Blacklist Refresh Token (Bảo mật 2026)
   */
  static async logout(refreshToken: string, userId: string) {
    // Đưa Refresh Token vào Blacklist trong Redis (Hết hạn sau 7 ngày theo config)
    const SEVEN_DAYS = 7 * 24 * 60 * 60;
    await redis.set(`blacklist:${refreshToken}`, 'true', 'EX', SEVEN_DAYS);

    // Audit Log
    await AuditLog.create({
      userId,
      action: 'LOGOUT',
      resource: 'User',
      status: 'SUCCESS'
    });

    return { success: true };
  }
}