import type { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from '../../services/AuthService.ts';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  if (!token) return false;
  try {
    const secret = process.env.TURNSTILE_SECRET_KEY || '';
    const formData = new URLSearchParams();
    formData.append('secret', secret);
    formData.append('response', token);
    if (ip) formData.append('remoteip', ip);
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: formData,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const outcome = await res.json() as any;
    return outcome.success === true;
  } catch {
    return false;
  }
}

function getFrontendUrl(): string {
  return process.env.FRONTEND_URL || 'https://frontend-datn-tau.vercel.app';
}

export class AuthPageController {
  static async checkReferer(request: FastifyRequest, reply: FastifyReply) {
    const referer = (request.headers['referer'] as string) || (request.headers['referrer'] as string) || '';
    const origin = (request.headers['origin'] as string) || '';
    const host = request.headers['host'] || '';
    const frontendUrl = getFrontendUrl();
    if (referer && referer.startsWith(frontendUrl)) return;
    if (origin && origin.startsWith(frontendUrl)) return;
    const backendBase = 'http://' + host;
    if (referer && referer.startsWith(backendBase)) return;
    if (request.method === 'GET') return;
    return reply.code(403).send({ error: 'Forbidden', message: 'Vui lòng truy cập từ cửa hàng chính thức.' });
  }

  static async getLoginPage(request: FastifyRequest, reply: FastifyReply) {
    return reply.view('auth.ejs', { mode: 'login', turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '', frontendUrl: getFrontendUrl() });
  }

  static async getRegisterPage(request: FastifyRequest, reply: FastifyReply) {
    return reply.view('auth.ejs', { mode: 'register', turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '', frontendUrl: getFrontendUrl() });
  }

  static async loginPageAction(request: FastifyRequest, reply: FastifyReply) {
    const data = request.body as any;
    const turnstileValid = await verifyTurnstile(data.turnstileToken, request.ip);
    if (!turnstileValid) return reply.send({ success: false, message: 'Xác minh bảo mật thất bại.' });
    try {
      const result = await AuthService.login(data, { ip: request.ip, userAgent: request.headers['user-agent'] || 'unknown' });
      const role = result.user.role;
      if (role === "ADMIN" || role === "SUBADMIN") {
        // Admin -> redirect ve Admin Panel (backend SSR)
        const adminUrl = "/admin";
        reply.header("Set-Cookie", `admin_token=${encodeURIComponent(result.tokens.accessToken)}; Path=/; SameSite=Lax; HttpOnly`);
        return reply.send({ success: true, message: "Đăng nhập quản trị thành công", redirectUrl: adminUrl });
      }
      // User -> redirect ve Frontend
      const redirectUrl = getFrontendUrl() + '/auth/callback?accessToken=' + encodeURIComponent(result.tokens.accessToken) + '&refreshToken=' + encodeURIComponent(result.tokens.refreshToken);
      return reply.send({ success: true, message: 'Đăng nhập thành công', redirectUrl });
    } catch (error: any) {
      return reply.send({ success: false, message: error.message || 'Email hoặc mật khẩu không chính xác' });
    }
  }

  static async registerPageAction(request: FastifyRequest, reply: FastifyReply) {
    const data = request.body as any;
    const turnstileValid = await verifyTurnstile(data.turnstileToken, request.ip);
    if (!turnstileValid) return reply.send({ success: false, message: 'Xác minh bảo mật thất bại.' });
    try {
      await AuthService.register(data);
      return reply.send({ success: true, message: 'Đăng ký thành công' });
    } catch (error: any) {
      return reply.send({ success: false, message: error.message || 'Đăng ký thất bại.' });
    }
  }
}
