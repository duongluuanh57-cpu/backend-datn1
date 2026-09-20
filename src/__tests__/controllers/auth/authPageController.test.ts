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
});
