import type { FastifyReply } from 'fastify';
import { ACCESS_COOKIE, REFRESH_COOKIE, ADMIN_COOKIE } from './auth.ts';

/**
 * Vì sao phải SameSite=None ở production:
 * FE chạy trên *.vercel.app, backend trên *.onrender.com — hai *site* khác nhau
 * (registrable domain), nên cookie SameSite=Lax bị trình duyệt chặn trên mọi request
 * API: đăng nhập set được cookie nhưng không request nào gửi lại → mọi route cần
 * auth trả 401 và F5 mất phiên. SameSite='none' là lựa chọn duy nhất chạy được.
 *
 * 'none' BẮT BUỘC đi kèm Secure — browser bỏ cookie nếu thiếu Secure. Chỉ bật ở
 * production (HTTPS); dev localhost:3000 → localhost:4000 vẫn same-site nên giữ 'lax',
 * và http:// dev không có HTTPS thì 'none' sẽ bị chặn hoàn toàn.
 *
 * Đổi lại: Lax trước đây kiêm luôn việc chặn cookie gửi từ site khác (một lớp chống
 * CSRF). Bỏ Lax nghĩa là state-changing request phải tự kiểm tra Origin
 * — xem middleware/originGuard.ts.
 */
export function sessionCookieAttrs() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    path: '/',
  };
}

// TTL cookie phải khớp TTL JWT tương ứng trong utils/auth.ts ('15m' / '7d' / '12h'):
// dài hơn thì browser giữ lại cookie của token đã hết hạn, ngắn hơn thì mất phiên
// sớm hơn tuổi thật của token.
export const ACCESS_COOKIE_MAX_AGE = 15 * 60;
export const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60;
export const ADMIN_COOKIE_MAX_AGE = 12 * 60 * 60;

export function setSessionCookies(
  reply: FastifyReply,
  tokens: { accessToken: string; refreshToken: string }
): void {
  const attrs = sessionCookieAttrs();
  void reply.setCookie(ACCESS_COOKIE, tokens.accessToken, { ...attrs, maxAge: ACCESS_COOKIE_MAX_AGE });
  void reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, { ...attrs, maxAge: REFRESH_COOKIE_MAX_AGE });
}

/**
 * Cookie riêng cho route /admin/* (adminAuthMiddleware đọc đúng tên này). Giá trị là
 * CÙNG một accessToken mà access_token mang — khác nhau ở TTL (12h vs 15') và ở chỗ
 * nó không bị các route user đụng tới. ADMIN đăng nhập được set cả ba cookie vì FE
 * khôi phục phiên chỉ qua /auth/refresh, cần refresh_token tồn tại.
 */
export function setAdminCookie(reply: FastifyReply, accessToken: string): void {
  void reply.setCookie(ADMIN_COOKIE, accessToken, { ...sessionCookieAttrs(), maxAge: ADMIN_COOKIE_MAX_AGE });
}

export function clearSessionCookies(reply: FastifyReply): void {
  // Xóa phải lặp lại ĐÚNG bộ attributes lúc set (sameSite/secure/domain/path),
  // nếu không browser coi là cookie khác và cookie cũ vẫn nằm lại.
  const attrs = sessionCookieAttrs();
  void reply.clearCookie(ACCESS_COOKIE, attrs);
  void reply.clearCookie(REFRESH_COOKIE, attrs);
  void reply.clearCookie(ADMIN_COOKIE, attrs);
}
