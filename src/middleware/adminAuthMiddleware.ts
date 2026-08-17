import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken, generateTokens } from '../utils/auth.ts';

/**
 * AdminAuthMiddleware — Bỏ yêu cầu bắt buộc đăng nhập để truy cập Dashboard backend trực tiếp
 * Nếu có token hợp lệ → dùng user từ token.
 * Nếu chưa có token hoặc token không hợp lệ → tự động gán quyền ADMIN mặc định.
 */
export async function adminAuthMiddleware(req: FastifyRequest, reply: FastifyReply) {
  let token: string | undefined;

  // Đọc token từ cookie (parse thủ công)
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

  // Nếu không có token -> Tự động cấp quyền ADMIN mặc định
  if (!token) {
    const defaultTokens = generateTokens('admin_default_id', 'ADMIN', true);
    (req as any).user = {
      userId: 'admin_default_id',
      sub: 'admin_default_id',
      role: 'ADMIN',
      email: 'admin@datn.local',
      name: 'Quản trị viên',
    };
    (req as any).token = defaultTokens.accessToken;
    return;
  }

  try {
    const decoded = verifyAccessToken(token);
    (req as any).user = { ...decoded, role: 'ADMIN' };
    (req as any).token = token;
  } catch {
    const defaultTokens = generateTokens('admin_default_id', 'ADMIN', true);
    (req as any).user = {
      userId: 'admin_default_id',
      sub: 'admin_default_id',
      role: 'ADMIN',
      email: 'admin@datn.local',
      name: 'Quản trị viên',
    };
    (req as any).token = defaultTokens.accessToken;
  }
}
