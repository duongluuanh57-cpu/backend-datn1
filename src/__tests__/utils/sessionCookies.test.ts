import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionCookieAttrs, setSessionCookies, setAdminCookie, clearSessionCookies } from '../../utils/sessionCookies.ts';

const originalEnv = process.env.NODE_ENV;
const originalRender = process.env.RENDER;

afterEach(() => {
  process.env.NODE_ENV = originalEnv;
  if (originalRender === undefined) delete process.env.RENDER;
  else process.env.RENDER = originalRender;
});

describe('sessionCookieAttrs', () => {
  it('giữ SameSite=Lax ngoài production (dev localhost → localhost vẫn same-site)', () => {
    process.env.NODE_ENV = 'development';
    expect(sessionCookieAttrs()).toMatchObject({ httpOnly: true, secure: false, sameSite: 'lax', path: '/' });
  });

  it('dùng SameSite=None + Secure ở production — cookie cross-site Vercel→Render', () => {
    // SameSite=None mà thiếu Secure là browser BỎ cookie luôn, nên hai cái phải đi cặp.
    process.env.NODE_ENV = 'production';
    expect(sessionCookieAttrs()).toMatchObject({ httpOnly: true, secure: true, sameSite: 'none', path: '/' });
  });

  it('coi Render là production dù NODE_ENV chưa set — dashboard Render không tự set nó', () => {
    process.env.NODE_ENV = 'development';
    process.env.RENDER = 'true';
    expect(sessionCookieAttrs()).toMatchObject({ httpOnly: true, secure: true, sameSite: 'none', path: '/' });
  });
});

describe('setSessionCookies / setAdminCookie / clearSessionCookies', () => {
  const makeReply = () => {
    const setCookie = vi.fn();
    const clearCookie = vi.fn();
    return { reply: { setCookie, clearCookie } as any, setCookie, clearCookie };
  };

  it('set cả access + refresh cookie với maxAge khớp TTL JWT', () => {
    process.env.NODE_ENV = 'production';
    const { reply, setCookie } = makeReply();

    setSessionCookies(reply, { accessToken: 'at', refreshToken: 'rt' });

    expect(setCookie).toHaveBeenCalledWith('access_token', 'at', expect.objectContaining({ sameSite: 'none', secure: true, maxAge: 15 * 60 }));
    expect(setCookie).toHaveBeenCalledWith('refresh_token', 'rt', expect.objectContaining({ sameSite: 'none', secure: true, maxAge: 7 * 24 * 60 * 60 }));
  });

  it('admin chỉ có duy nhất cookie access 12 giờ, không có refresh', () => {
    process.env.NODE_ENV = 'production';
    const { reply, setCookie } = makeReply();

    setAdminCookie(reply, 'admin-at');

    expect(setCookie).toHaveBeenCalledTimes(1);
    expect(setCookie).toHaveBeenCalledWith('admin_token', 'admin-at', expect.objectContaining({ sameSite: 'none', maxAge: 12 * 60 * 60 }));
  });

  it('clear lại đúng 3 cookie với cùng attributes lúc set', () => {
    process.env.NODE_ENV = 'production';
    const { reply, clearCookie } = makeReply();

    clearSessionCookies(reply);

    // Clear sai attributes (khác sameSite/secure/path) = browser coi là cookie khác
    // và cookie cũ vẫn nằm nguyên trong jar.
    for (const name of ['access_token', 'refresh_token', 'admin_token']) {
      expect(clearCookie).toHaveBeenCalledWith(name, expect.objectContaining({ sameSite: 'none', secure: true, path: '/', httpOnly: true }));
    }
  });
});
