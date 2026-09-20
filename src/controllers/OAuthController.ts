import type { FastifyRequest, FastifyReply } from 'fastify';
import { OAuthService } from '../services/OAuthService.ts';
import { redis } from '../config/redis.ts';
import { ValidationError } from '../utils/errors.ts';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../utils/auth.ts';

// Khớp cấu hình cookie với authSessionController
const isProd = process.env.NODE_ENV === 'production';
const ACCESS_COOKIE_MAX_AGE = 15 * 60;           // 15 phút (giây)
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 ngày (giây)
const ADMIN_COOKIE_MAX_AGE = 12 * 60 * 60;       // 12 giờ (giây)

const baseCookie = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax' as const,
  path: '/',
};

function setSessionCookies(reply: FastifyReply, tokens: { accessToken: string; refreshToken: string }) {
  void reply.setCookie(ACCESS_COOKIE, tokens.accessToken, { ...baseCookie, maxAge: ACCESS_COOKIE_MAX_AGE });
  void reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, { ...baseCookie, maxAge: REFRESH_COOKIE_MAX_AGE });
}

export class OAuthController {
  /**
   * Bước 1: Redirect user sang Google để đăng nhập
   * GET /api/auth/google
   */
  static async initiateGoogle(req: FastifyRequest, reply: FastifyReply) {
    const state = OAuthService.generateState();
    // Lưu state vào Redis 10 phút để xác minh CSRF sau này
    await redis.set(`oauth:state:${state}`, '1', 'EX', 600);

    const authUrl = OAuthService.getGoogleAuthUrl(state);
    return reply.redirect(authUrl);
  }

  /**
   * Bước 2: Google redirect về đây với "code" — đổi code lấy user info và tạo JWT
   * GET /api/auth/google/callback?code=...&state=...
   *
   * Bảo mật: token KHÔNG truyền qua URL query nữa (lọt vào browser history/log).
   * Thay vào đó: set httpOnly cookie ngay trên response redirect,
   * frontend sẽ gọi /api/auth/me (kèm cookie) để lấy user info.
   */
  static async googleCallback(req: FastifyRequest, reply: FastifyReply) {
    const { code, state, error } = req.query as any;

    if (error) throw new ValidationError(`Google OAuth Error: ${error}`);

    // Xác minh state chống CSRF
    const stateValid = await redis.get(`oauth:state:${state}`);
    if (!stateValid) throw new ValidationError('Invalid hoặc hết hạn state parameter');
    await redis.del(`oauth:state:${state}`);

    const result = await OAuthService.handleGoogleCallback(code);
    const frontendUrl = process.env.FRONTEND_URL || 'https://lessence-livid.vercel.app';

    // Set session cookie trước, rồi redirect về FE với URL sạch
    if (result.user.role === 'ADMIN') {
      reply.header(
        'Set-Cookie',
        `admin_token=${encodeURIComponent(result.tokens.accessToken)}; Path=/; SameSite=Lax; HttpOnly${isProd ? '; Secure' : ''}; Max-Age=${ADMIN_COOKIE_MAX_AGE}`
      );
    } else {
      setSessionCookies(reply, result.tokens);
    }

    const redirectUrl = new URL(`${frontendUrl}/auth/callback`);
    // Chỉ mang tín hiệu trạng thái, không mang secret
    redirectUrl.searchParams.set('login', 'success');

    return reply.redirect(redirectUrl.toString());
  }
}
