import 'dotenv/config';
import { buildApp } from './app.ts';

const app = buildApp();
const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '0.0.0.0';

const start = async () => {
  try {
    warnIfCookieModeMismatch();
    const address = await app.listen({ port: PORT, host: HOST });
    console.log(`Backend is live at: ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

/**
 * Cookie session chỉ là SameSite=None khi NODE_ENV=production. Thiếu biến đó trên
 * Render thì backend vẫn set Lax, trình duyệt âm thầm không gửi cookie cho FE ở site
 * khác — mọi route auth trả 401 mà log backend không có lỗi nào.
 */
function warnIfCookieModeMismatch() {
  const hasCrossSiteHttps = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .some((o) => /^https:\/\//i.test(o.trim()));
  if (hasCrossSiteHttps && process.env.NODE_ENV !== 'production') {
    app.log.warn(
      `NODE_ENV=${process.env.NODE_ENV ?? '(trống)'} trong khi ALLOWED_ORIGINS có origin HTTPS khác site: ` +
        'cookie session đang là SameSite=Lax và sẽ bị trình duyệt chặn trên frontend. Đặt NODE_ENV=production.'
    );
  }
}

start();