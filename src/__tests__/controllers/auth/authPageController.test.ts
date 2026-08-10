import { describe, it, expect, vi } from 'vitest';
import { AuthPageController } from '../../../controllers/auth/authPageController.ts';

describe('AuthPageController', () => {
  describe('getLoginPage', () => {
    it('uses localhost frontend URL when Referer is localhost', async () => {
      const req = { headers: { referer: 'http://localhost:3000/some-page' } } as any;
      let viewPath = '', viewData: any = {};
      const reply = { view: (p: string, d: any) => { viewPath = p; viewData = d; return reply; } } as any;
      await AuthPageController.getLoginPage(req, reply);
      expect(viewPath).toBe('auth.ejs');
      expect(viewData.frontendUrl).toBe('http://localhost:3000');
    });

    it('uses localhost frontend URL when Referer is localhost with port', async () => {
      const req = { headers: { referer: 'http://127.0.0.1:3000/login' } } as any;
      let viewData: any = {};
      const reply = { view: (_p: string, d: any) => { viewData = d; return reply; } } as any;
      await AuthPageController.getLoginPage(req, reply);
      expect(viewData.frontendUrl).toBe('http://127.0.0.1:3000');
    });

    it('falls back to env FRONTEND_URL when no localhost Referer', async () => {
      const req = { headers: { referer: 'https://frontend-datn-tau.vercel.app/login' } } as any;
      let viewData: any = {};
      const reply = { view: (_p: string, d: any) => { viewData = d; return reply; } } as any;
      await AuthPageController.getLoginPage(req, reply);
      expect(viewData.frontendUrl).toBe('https://frontend-datn-tau.vercel.app');
    });

    it('falls back to default when no Referer header', async () => {
      const req = { headers: {} } as any;
      let viewData: any = {};
      const reply = { view: (_p: string, d: any) => { viewData = d; return reply; } } as any;
      await AuthPageController.getLoginPage(req, reply);
      expect(viewData.frontendUrl).toBe('https://frontend-datn-tau.vercel.app');
    });
  });

  describe('getRegisterPage', () => {
    it('uses localhost frontend URL when Referer is localhost', async () => {
      const req = { headers: { referer: 'http://localhost:3000/register' } } as any;
      let viewData: any = {};
      const reply = { view: (_p: string, d: any) => { viewData = d; return reply; } } as any;
      await AuthPageController.getRegisterPage(req, reply);
      expect(viewData.frontendUrl).toBe('http://localhost:3000');
      expect(viewData.mode).toBe('register');
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
