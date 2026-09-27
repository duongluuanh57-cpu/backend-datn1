/**
 * Nguồn duy nhất cho danh sách Origin được gửi kèm cookie.
 *
 * Tách khỏi app.ts vì giờ có HAI chỗ phải dùng chung: CORS (@fastify/cors) quyết
 * định browser có cho ĐỌC response, còn originGuard quyết định server có nhận
 * mutation. Hai cấu hình lệch nhau là một trong hai kiểu hỏng: CORS mở nhưng guard
 * chặn (FE chết oan), hoặc CORS chặn nhưng guard mở (CSRF qua mặt).
 *
 * Đọc env TRONG hàm chứ không phải lúc import module: app.ts chỉ gọi từ buildApp(),
 * còn test thì có thể đổi process.env ngay trước khi inject request.
 */
const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'https://lessence-livid.vercel.app',
  'https://frontend-datn-tau.vercel.app',
];

export function getAllowedOrigins(): string[] {
  // ALLOWED_ORIGINS rỗng hoặc chỉ toàn dấu phẩy mà vẫn `split()` ra `['']` thì coi
  // như "không origin nào" — phải lọc xong mới xét default.
  const fromEnv = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_ORIGINS;
}

/** Chuẩn hoá về origin thuần (bỏ path/trailing slash) để so khớp header `Origin`. */
function normalize(value: string): string | null {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

export function isTrustedOrigin(origin: string): boolean {
  const value = normalize(origin);
  if (!value) return false;
  return getAllowedOrigins().some((o) => normalize(o) === value);
}

/** Origin trỏ đúng host của backend — các form admin cũ chạy cùng domain với API. */
export function isSameHostAsServer(origin: string, serverHost: string | undefined): boolean {
  if (!serverHost) return false;
  try {
    return new URL(origin).host.toLowerCase() === serverHost.toLowerCase();
  } catch {
    return false;
  }
}
