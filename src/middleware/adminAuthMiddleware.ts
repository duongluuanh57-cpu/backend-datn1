import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../utils/auth.ts';
import { normalizeTenant } from '../utils/tenantHelper.ts';

/**
 * AdminAuthMiddleware — Bảo vệ trang Admin (SSR)
 * Đọc JWT từ cookie "admin_token" hoặc header Authorization.
 * Chỉ cho phép role ADMIN hoặc SUBADMIN.
 * Nếu không hợp lệ → redirect về trang login.
 */
export async function adminAuthMiddleware(req: FastifyRequest, reply: FastifyReply) {
  let token: string | undefined;

  // Đọc token từ cookie (parse thủ công, không cần @fastify/cookie)
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)admin_token=([^;]*)/);
  token = match ? decodeURIComponent(match[1]) : undefined;

  // Fallback: đọc từ header Authorization
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
  }

  if (!token) {
    return reply.redirect('/api/auth/login');
  }

  try {
    const decoded = verifyAccessToken(token);

    // Chỉ ADMIN và SUBADMIN mới được vào
    if (decoded.role !== 'ADMIN' && decoded.role !== 'SUBADMIN') {
      return reply.status(403).send('Forbidden: Yêu cầu quyền quản trị viên');
    }

    // Gắn user vào request để dùng trong controller
    (req as any).user = { ...decoded, tenantId: normalizeTenant(decoded.tenantId) };
    (req as any).token = token;
  } catch {
    return reply.redirect('/api/auth/login');
  }
}
