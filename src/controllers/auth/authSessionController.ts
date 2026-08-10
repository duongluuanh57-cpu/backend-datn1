import type { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from '../../services/AuthService.ts';
import { verifyAccessToken, verifyRefreshToken, generateTokens } from '../../utils/auth.ts';
import { redis } from '../../config/redis.ts';
import { UnauthorizedError } from '../../utils/errors.ts';
import { UserRepository } from '../../repositories/UserRepository.ts';

export class AuthSessionController {
  static async register(request: FastifyRequest, reply: FastifyReply) {
    const data = request.body as any;
    const result = await AuthService.register(data);

    return reply.status(201).send({
      success: true,
      message: 'Đăng ký thành công',
      data: result,
    });
  }

  static async login(request: FastifyRequest, reply: FastifyReply) {
    const data = request.body as any;
    const metadata = {
      ip: request.ip,
      userAgent: request.headers['user-agent'] || 'unknown'
    };
    const result = await AuthService.login(data, metadata);

    return reply.send({
      success: true,
      message: 'Đăng nhập thành công',
      data: result,
    });
  }

  /**
   * Dùng Refresh Token để cấp Access Token mới (không cần đăng nhập lại)
   * POST /api/auth/refresh
   */
  static async refresh(request: FastifyRequest, reply: FastifyReply) {
    const { refreshToken } = request.body as { refreshToken: string };
    if (!refreshToken) throw new UnauthorizedError('Refresh token là bắt buộc');

    // Kiểm tra Blacklist trước
    const isBlacklisted = await redis.get(`blacklist:${refreshToken}`);
    if (isBlacklisted) throw new UnauthorizedError('Token đã bị thu hồi');

    // Verify refresh token (bao gồm issuer, algorithm, type checks)
    const { userId } = verifyRefreshToken(refreshToken);

    // Tìm user để lấy role mới nhất từ DB
    const user = await UserRepository.findById(userId);
    if (!user) throw new UnauthorizedError('Người dùng không tồn tại');

    const tokens = generateTokens(userId, user.role, false);

    return reply.send({
      success: true,
      message: 'Cấp lại token thành công',
      data: tokens,
    });
  }

  /**
   * Nhận token từ query param, validate, set cookie admin_token,
   * redirect sang /admin. Dùng GET + top-level navigation
   * để tránh CORS và SameSite cookie issue.
   * GET /api/auth/set-admin-session?token=...
   */
  static async setAdminSession(request: FastifyRequest, reply: FastifyReply) {
    const { token } = request.query as { token: string };
    if (!token) {
      return reply.redirect('/login');
    }
    try {
      const decoded = verifyAccessToken(token);
      if (decoded.role !== 'ADMIN' && decoded.role !== 'SUBADMIN') {
        return reply.redirect('/login');
      }
      reply.header('Set-Cookie', `admin_token=${encodeURIComponent(token)}; Path=/; SameSite=Lax; HttpOnly`);
      return reply.redirect('/admin');
    } catch {
      return reply.redirect('/login');
    }
  }

  static async logout(request: FastifyRequest, reply: FastifyReply) {
    const { refreshToken } = request.body as { refreshToken: string };
    if (!refreshToken) throw new UnauthorizedError('Refresh token là bắt buộc');

    // Đưa token vào Blacklist — hết hạn sau 7 ngày (bằng TTL của refresh token)
    await redis.set(`blacklist:${refreshToken}`, '1', 'EX', 60 * 60 * 24 * 7);

    return reply.send({
      success: true,
      message: 'Đăng xuất thành công',
    });
  }
}