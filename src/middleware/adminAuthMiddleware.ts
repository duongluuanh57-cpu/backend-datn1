import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../utils/auth.ts';
import { UnauthorizedError, ForbiddenError } from '../utils/errors.ts';

/**
 * AdminAuthMiddleware — bắt buộc token ADMIN cho mọi route /admin/*.
 * Token đọc từ cookie admin_token hoặc header Authorization (Bearer).
 * - Không có token / token không hợp lệ → 401
 * - Token hợp lệ nhưng role != ADMIN → 403
 */
export async function adminAuthMiddleware(req: FastifyRequest, reply: FastifyReply) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)admin_token=([^;]*)/);
  let token: string | undefined = match ? decodeURIComponent(match[1]) : undefined;

  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
  }

  if (!token) throw new UnauthorizedError('Vui lòng đăng nhập với tài khoản quản trị');

  let decoded: { userId: string; role: string };
  try {
    decoded = verifyAccessToken(token);
  } catch (err: any) {
    throw new UnauthorizedError(err?.message || 'Token không hợp lệ hoặc đã hết hạn');
  }

  if (decoded.role !== 'ADMIN') throw new ForbiddenError('Bạn không có quyền truy cập trang quản trị');

  (req as any).user = { userId: decoded.userId, role: 'ADMIN' };
  (req as any).token = token;
}
