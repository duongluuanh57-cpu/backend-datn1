import type { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from '../../services/AuthService.ts';
import { AuthRegisterService } from '../../services/auth/authRegisterService.ts';
import { detectFrontendUrl } from '../../utils/viewHelpers.ts';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  if (!token) return false;
  try {
    const secret = process.env.TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET || '0x4AAAAAAESq8PaG7jLudjuSkaJG3fNrO2s';
    const formData = new URLSearchParams();
    formData.append('secret', secret);
    formData.append('response', token);
    if (ip && !['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'].includes(ip)) {
      formData.append('remoteip', ip);
    }
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: formData,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const outcome = await res.json() as any;
    console.log('[Turnstile verify result]:', outcome);
    return outcome.success === true;
  } catch (err) {
    console.error('[Turnstile verify error]:', err);
    return false;
  }
}

export class AuthPageController {
  static async getLoginPage(request: FastifyRequest, reply: FastifyReply) {
    const frontendUrl = detectFrontendUrl(request);
    return reply.redirect(`${frontendUrl.replace(/\/+$/, '')}/auth/login`);
  }

  static async getRegisterPage(request: FastifyRequest, reply: FastifyReply) {
    const frontendUrl = detectFrontendUrl(request);
    return reply.redirect(`${frontendUrl.replace(/\/+$/, '')}/auth/register`);
  }

  static async loginPageAction(request: FastifyRequest, reply: FastifyReply) {
    const data = request.body as any;
    const turnstileValid = await verifyTurnstile(data.turnstileToken, request.ip);
    if (!turnstileValid) return reply.send({ success: false, message: 'Xác minh bảo mật thất bại.' });
    try {
      const result = await AuthService.login(data, { ip: request.ip, userAgent: request.headers['user-agent'] || 'unknown' });
      const role = result.user.role;
      if (role === "ADMIN") {
        const adminUrl = "/admin";
        reply.header("Set-Cookie", `admin_token=${encodeURIComponent(result.tokens.accessToken)}; Path=/; SameSite=Lax; HttpOnly`);
        return reply.send({ success: true, message: "Đăng nhập quản trị thành công", redirectUrl: adminUrl });
      }
      const frontendUrl = data.frontendUrl || detectFrontendUrl(request);
      const redirectUrl = frontendUrl + '/auth/callback?accessToken=' + encodeURIComponent(result.tokens.accessToken) + '&refreshToken=' + encodeURIComponent(result.tokens.refreshToken);
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
      const result = await AuthRegisterService.register(data);
      return reply.send({ success: true, message: 'Đăng ký tài khoản thành công', data: result });
    } catch (error: any) {
      return reply.send({ success: false, message: error.message || 'Đăng ký thất bại' });
    }
  }
}
