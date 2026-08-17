import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthPageController } from '../../../controllers/auth/authPageController.ts';

describe('AuthPageController', () => {
  beforeEach(() => {
    vi.stubEnv('FRONTEND_URL', 'https://lessence-livid.vercel.app');
  });

  describe('getLoginPage', () => {
    it('redirects to localhost frontend URL when Referer is localhost', async () => {
      const req = { headers: { referer: 'http://localhost:3000/some-page' } } as any;
      let redirectUrl = '';
      const reply = { redirect: (url: string) => { redirectUrl = url; return reply; } } as any;
      await AuthPageController.getLoginPage(req, reply);
      expect(redirectUrl).toBe('http://localhost:3000/auth/login');
    });

    it('redirects to env FRONTEND_URL when no localhost Referer', async () => {
      const req = { headers: {} } as any;
      let redirectUrl = '';
      const reply = { redirect: (url: string) => { redirectUrl = url; return reply; } } as any;
      await AuthPageController.getLoginPage(req, reply);
      expect(redirectUrl).toBe('https://lessence-livid.vercel.app/auth/login');
    });
  });

  describe('getRegisterPage', () => {
    it('redirects to localhost frontend URL when Referer is localhost', async () => {
      const req = { headers: { referer: 'http://localhost:3000/register' } } as any;
      let redirectUrl = '';
      const reply = { redirect: (url: string) => { redirectUrl = url; return reply; } } as any;
      await AuthPageController.getRegisterPage(req, reply);
      expect(redirectUrl).toBe('http://localhost:3000/auth/register');
    });
  });

  describe('loginPageAction', () => {
    it('returns error when turnstile token is missing', async () => {
      const req = { body: { email: 'test@test.com', password: '123456', turnstileToken: '' }, ip: '127.0.0.1', headers: {} } as any;
      let sentBody: any = {};
      const reply = { send: (b: any) => { sentBody = b; return reply; } } as any;
      await AuthPageController.loginPageAction(req, reply);
      expect(sentBody.success).toBe(false);
      expect(sentBody.message).toBe('Xác minh bảo mật thất bại.');
    });

    it('returns error when AuthService throws', async () => {
      const req = { body: { email: 'wrong@test.com', password: 'wrong', turnstileToken: 'dummy' }, ip: '127.0.0.1', headers: {} } as any;
      let sentBody: any = {};
      const reply = { send: (b: any) => { sentBody = b; return reply; } } as any;
      await AuthPageController.loginPageAction(req, reply);
      expect(sentBody.success).toBe(false);
    });
  });
});
