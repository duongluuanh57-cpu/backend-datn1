import type { FastifyRequest } from 'fastify';
import { verifyAccessToken, extractAccessToken } from './auth.ts';

/**
 * Rate-limit identity — đọc access token NGAY TẠI onRequest (pha keyGenerator).
 * @fastify/rate-limit chạy ở onRequest, trước mọi preHandler nên request.user
 * (do authMiddleware set) chưa bao giờ tồn tại ở đây.
 * Token lấy qua đúng extractAccessToken() mà authMiddleware dùng: FE xác thực
 * bằng httpOnly cookie, đọc riêng header Bearer là mọi trình duyệt bị tính là
 * khách ẩn danh (120/phút/IP) và quota theo role không bao giờ được dùng.
 * Verify thật (không chỉ decode) để không ai fake role lấy quota cao hơn.
 */
interface RateLimitIdentity {
  userId?: string;
  role?: string;
}

function identity(request: FastifyRequest): RateLimitIdentity {
  const cached = (request as any).rateLimitIdentity as RateLimitIdentity | undefined;
  if (cached) return cached;

  let found: RateLimitIdentity = {};
  const token = extractAccessToken(request);
  if (token) {
    try {
      const decoded = verifyAccessToken(token);
      found = { userId: decoded.userId, role: decoded.role };
    } catch {
      // Token hỏng/hết hạn → coi như anonymous, không throw (keyGenerator throw là sập mọi request)
    }
  }
  (request as any).rateLimitIdentity = found;
  return found;
}

/** Key theo userId nếu đăng nhập, fallback IP. */
export function rateLimitKey(request: FastifyRequest): string {
  return identity(request).userId || request.ip;
}

/**
 * E2E_SKIP_RATE_LIMIT — bỏ qua mọi quota, chỉ cho bật ở môi trường không phải
 * production (Playwright boot BE với E2E_DISABLE_RATE_LIMIT=1). Một suite e2e chạy
 * 30+ login + hàng trăm request từ CÙNG một IP trong vài phút, đủ để tự 429 chính
 * mình ở mọi tầng limit.
 */
export const E2E_SKIP_RATE_LIMIT =
  process.env.NODE_ENV !== 'production' && process.env.E2E_DISABLE_RATE_LIMIT === '1';

/** Quota theo role: GET/HEAD 1000, ADMIN 500, USER 600, ẩn danh 120. */
export function rateLimitMax(request: FastifyRequest): number {
  if (request.method === 'GET' || request.method === 'HEAD') return 1000;
  const role = identity(request).role;
  if (role === 'ADMIN') return 500;
  if (role === 'USER') return 600;
  return 120;
}
