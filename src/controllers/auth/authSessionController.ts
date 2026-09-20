import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  verifyTurnstile,
  verifyRefreshToken,
  refreshTokenBlacklistKey,
  generateTokens,
  toPublicUser,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  ADMIN_COOKIE,
} from '../../utils/auth.ts';
import { UnauthorizedError } from '../../utils/errors.ts';
import { redis } from '../../config/redis.ts';
import { UserRepository } from '../../repositories/UserRepository.ts';
import { AuthRegisterService } from '../../services/auth/authRegisterService.ts';
import { AuthSessionService } from '../../services/auth/authSessionService.ts';
import type { RegisterInput, LoginInput } from '../../types/user.types.ts';

// ── Cookie options: token nằm trong httpOnly cookie, JS không đọc được (chống XSS) ──
const isProd = process.env.NODE_ENV === 'production';
const ACCESS_COOKIE_MAX_AGE = 15 * 60;        // 15 phút (giây) — khớp access token user
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 ngày (giây) — khớp refresh token user
const ADMIN_COOKIE_MAX_AGE = 12 * 60 * 60;    // 12 giờ (giây) — khớp access token admin

const baseCookie = {
  httpOnly: true,
  secure: isProd,              // production chạy HTTPS → bắt buộc Secure
  sameSite: 'lax' as const,
  path: '/',
};

function setSessionCookies(reply: FastifyReply, tokens: { accessToken: string; refreshToken: string }) {
  void reply.setCookie(ACCESS_COOKIE, tokens.accessToken, { ...baseCookie, maxAge: ACCESS_COOKIE_MAX_AGE });
  void reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, { ...baseCookie, maxAge: REFRESH_COOKIE_MAX_AGE });
}

function clearSessionCookies(reply: FastifyReply) {
  void reply.clearCookie(ACCESS_COOKIE, { ...baseCookie });
  void reply.clearCookie(REFRESH_COOKIE, { ...baseCookie });
  // Admin panel dùng cookie riêng — logout phải xóa cả hai, nếu không phiên admin sống dai
  void reply.clearCookie(ADMIN_COOKIE, { ...baseCookie });
}

export class AuthSessionController {
  static async register(request: FastifyRequest<{ Body: RegisterInput }>, reply: FastifyReply) {
    const data = request.body;

    await verifyTurnstile(data.turnstileToken, request.ip);

    const { user, tokens } = await AuthRegisterService.register(data);

    // Đăng ký xong = đăng nhập luôn: cấp luôn session cookie
    setSessionCookies(reply, tokens);

    return reply.status(201).send({
      success: true,
      message: 'Đăng ký thành công',
      data: {
        user,
        tokens,
      },
    });
  }

  static async login(request: FastifyRequest<{ Body: LoginInput }>, reply: FastifyReply) {
    const data = request.body;

    await verifyTurnstile(data.turnstileToken, request.ip);

    const metadata = {
      ip: request.ip,
      userAgent: request.headers?.['user-agent'] || 'unknown'
    };

    const { user, tokens } = await AuthSessionService.login(data, metadata);

    if (user.role === 'ADMIN') {
      // Cookie riêng cho admin panel — HttpOnly + Secure + Max-Age khớp TTL 12h
      reply.header(
        'Set-Cookie',
        `admin_token=${encodeURIComponent(tokens.accessToken)}; Path=/; SameSite=Lax; HttpOnly${isProd ? '; Secure' : ''}; Max-Age=${ADMIN_COOKIE_MAX_AGE}`
      );
    } else {
      setSessionCookies(reply, tokens);
    }

    return reply.send({
      success: true,
      message: 'Đăng nhập thành công',
      data: {
        user,
        tokens,
      },
    });
  }

  static async refresh(request: FastifyRequest, reply: FastifyReply) {
    // Nhận refresh token từ cookie (ưu tiên) hoặc body (tương thích ngược)
    const body = (request.body || {}) as { refreshToken?: string };
    const cookies = (request as any).cookies || {};
    const refreshToken = cookies[REFRESH_COOKIE] || body.refreshToken;
    if (!refreshToken) throw new UnauthorizedError('Refresh token là bắt buộc');

    const isBlacklisted = await redis.get(refreshTokenBlacklistKey(refreshToken, undefined));
    if (isBlacklisted) throw new UnauthorizedError('Token đã bị thu hồi');

    const { userId, jti, iat } = verifyRefreshToken(refreshToken);

    // Kiểm tra blacklist theo jti (token generation mới)
    if (jti) {
      const jtiBlacklisted = await redis.get(refreshTokenBlacklistKey(refreshToken, jti));
      if (jtiBlacklisted) throw new UnauthorizedError('Token đã bị thu hồi');
    }

    const user = await UserRepository.findByIdWithSecurity(userId);
    if (!user) throw new UnauthorizedError('Người dùng không tồn tại');

    // Chặn refresh cho tài khoản bị khóa — admin khóa tài khoản phải có tác dụng ngay,
    // không cho session cũ tự gia hạn vô hạn.
    if (user.status === 'suspended') {
      throw new UnauthorizedError('Tài khoản của bạn đã bị tạm khóa. Vui lòng liên hệ quản trị viên.');
    }
    if (user.status === 'inactive') {
      throw new UnauthorizedError('Tài khoản của bạn chưa được kích hoạt.');
    }

    // Đổi mật khẩu vô hiệu hóa mọi refresh token phát hành trước thời điểm đổi
    const pwdChangedAt = (user as any).passwordChangedAt ?? null;
    if (pwdChangedAt && iat && iat * 1000 < new Date(pwdChangedAt).getTime()) {
      throw new UnauthorizedError('Phiên đăng nhập đã hết hiệu lực do mật khẩu vừa được thay đổi. Vui lòng đăng nhập lại.');
    }

    // ── Rotation: token cũ chết ngay khi token mới được cấp ──
    const tokens = generateTokens(userId, user.role);
    if (jti) {
      await redis.set(
        refreshTokenBlacklistKey(refreshToken, jti),
        '1',
        'EX',
        REFRESH_COOKIE_MAX_AGE
      );
    }

    setSessionCookies(reply, tokens);

    // Trả kèm user public — frontend dùng để khôi phục session sau F5 mà không cần gọi thêm /me
    return reply.send({
      success: true,
      message: 'Cấp lại token thành công',
      data: {
        user: toPublicUser(user),
        tokens,
      },
    });
  }

  static async logout(request: FastifyRequest, reply: FastifyReply) {
    const body = (request.body || {}) as { refreshToken?: string };
    const cookies = (request as any).cookies || {};
    const refreshToken = cookies[REFRESH_COOKIE] || body.refreshToken;
    if (!refreshToken) throw new UnauthorizedError('Refresh token là bắt buộc');

    // Service tự verify token + blacklist theo jti (xác minh quyền sở hữu).
    // Cookie admin_token là access token stateless — không revoke được, chỉ có thể
    // xóa khỏi máy client và chờ hết hạn 12h.
    await AuthSessionService.logout(refreshToken);

    clearSessionCookies(reply);

    return reply.send({
      success: true,
      message: 'Đăng xuất thành công',
    });
  }
}
