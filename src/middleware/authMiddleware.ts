import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../utils/auth.ts';
import { UnauthorizedError } from '../utils/errors.ts';

// Mở rộng kiểu Fastify Request để TypeScript biết có thêm field `user`
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      userId: string;
      role: string;
    };
  }
}

/**
 * AuthMiddleware — Xác minh JWT từ header Authorization
 * Dùng verifyAccessToken() với đầy đủ JWT Best Practices:
 *   - Algorithm whitelist (HS256)
 *   - Validate issuer + audience
 *   - Validate token type (chống dùng refresh token như access token)
 */
export async function authMiddleware(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Vui lòng đăng nhập để tiếp tục');
  }

  const token = authHeader.substring(7);

  try {
    const decoded = verifyAccessToken(token);
    req.user = { userId: decoded.userId, role: decoded.role };
  } catch (err: any) {
    throw new UnauthorizedError(err.message || 'Token không hợp lệ hoặc đã hết hạn');
  }
}

/**
 * RequireRole — Kiểm tra role (RBAC)
 * Dùng sau authMiddleware để giới hạn quyền truy cập theo role
 *
 * Cách dùng trong route:
 *   app.delete('/users/:id', { preHandler: [authMiddleware, requireRole('ADMIN')] }, handler)
 */
export function requireRole(...roles: string[]) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    if (!req.user) throw new UnauthorizedError('Chưa xác thực');
    if (!roles.includes(req.user.role)) {
      reply.status(403).send({
        success: false,
        message: `Bạn không có quyền thực hiện thao tác này. Yêu cầu role: ${roles.join(', ')}`,
      });
    }
  };
}
