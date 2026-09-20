import type { FastifyRequest } from 'fastify';
import { verifyAccessToken } from './auth.ts';

/**
 * Rate-limit identity — đọc từ header Authorization NGAY TẠI onRequest.
 * @fastify/rate-limit chạy ở onRequest, trước mọi preHandler nên request.user
 * (do authMiddleware set) chưa bao giờ tồn tại ở đây — đọc user từ đó là dead code.
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
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const decoded = verifyAccessToken(authHeader.substring(7));
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

/** Quota theo role: GET/HEAD 1000, ADMIN 500, USER 600, ẩn danh 120. */
export function rateLimitMax(request: FastifyRequest): number {
  if (request.method === 'GET' || request.method === 'HEAD') return 1000;
  const role = identity(request).role;
  if (role === 'ADMIN') return 500;
  if (role === 'USER') return 600;
  return 120;
}
