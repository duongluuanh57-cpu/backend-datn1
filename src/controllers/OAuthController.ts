import type { FastifyRequest, FastifyReply } from 'fastify';
import { OAuthService } from '../services/OAuthService.ts';
import { redis } from '../config/redis.ts';
import { ValidationError } from '../utils/errors.ts';
import { setSessionCookies, setAdminCookie } from '../utils/sessionCookies.ts';

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

    // Set session cookie trước, rồi redirect về FE với URL sạch.
    // ADMIN phải có cả access+refresh: callback vừa xong thì FE gọi /api/auth/me
    // (bước 2 trong comment ở trên) — route đó đọc access_token, chỉ có admin_token là 401.
    setSessionCookies(reply, result.tokens);
    if (result.user.role === 'ADMIN') {
      setAdminCookie(reply, result.tokens.accessToken);
    }

    const redirectUrl = new URL(`${frontendUrl}/auth/callback`);
    // Chỉ mang tín hiệu trạng thái, không mang secret
    redirectUrl.searchParams.set('login', 'success');

    return reply.redirect(redirectUrl.toString());
  }
}
