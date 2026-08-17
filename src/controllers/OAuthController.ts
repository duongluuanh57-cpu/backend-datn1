import type { FastifyRequest, FastifyReply } from 'fastify';
import { OAuthService } from '../services/OAuthService.ts';
import { redis } from '../config/redis.ts';
import { ValidationError } from '../utils/errors.ts';

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
    
    // Redirect về Frontend kèm token
    const redirectUrl = new URL(`${frontendUrl}/auth/callback`);
    redirectUrl.searchParams.set('accessToken', result.tokens.accessToken);
    redirectUrl.searchParams.set('refreshToken', result.tokens.refreshToken);
    redirectUrl.searchParams.set('user', encodeURIComponent(JSON.stringify(result.user)));

    return reply.redirect(redirectUrl.toString());
  }
}
