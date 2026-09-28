import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken, isSessionRevoked, extractAccessToken } from '../utils/auth.ts';
import { UnauthorizedError } from '../utils/errors.ts';
import { UserRepository } from '../repositories/UserRepository.ts';

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
 * AuthMiddleware — Xác minh JWT từ httpOnly cookie (ưu tiên) hoặc Bearer header.
 * Dùng verifyAccessToken() với đầy đủ JWT Best Practices:
 *   - Algorithm whitelist (HS256)
 *   - Validate issuer + audience
 *   - Validate token type (chống dùng refresh token như access token)
 */
export async function authMiddleware(req: FastifyRequest, reply: FastifyReply) {
  const token = extractAccessToken(req);

  if (!token) {
    throw new UnauthorizedError('Vui lòng đăng nhập để tiếp tục');
  }

  try {
    const decoded = verifyAccessToken(token);
    // Token ký trước lần đổi mật khẩu gần nhất → không còn hiệu lực.
    if (await isSessionRevoked(decoded.userId, decoded.iat)) {
      throw new UnauthorizedError('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại');
    }
    // Admin khóa tài khoản phải có tác dụng NGAY trên access token đang sống (15 phút),
    // không đợi token hết hạn: login/refresh đều chặn sẵn, đây là lớp chặn mọi request
    // của phiên cũ đang chạy. Point query theo _id, các route công khai không đi qua đây.
    const account = await UserRepository.findById(decoded.userId);
    if (!account) throw new UnauthorizedError('Người dùng không tồn tại');
    if (account.status !== 'active') {
      throw new UnauthorizedError(
        account.status === 'suspended' ? 'Tài khoản của bạn đã bị khóa.' : 'Tài khoản của bạn không khả dụng.',
      );
    }
    req.user = { userId: decoded.userId, role: decoded.role };
  } catch (err: any) {
    throw new UnauthorizedError(err.message || 'Token không hợp lệ hoặc đã hết hạn');
  }
}

/**
 * OptionalAuthMiddleware — Xác minh JWT nếu có token (cookie/Bearer), không throw nếu không có
 */
export async function optionalAuthMiddleware(req: FastifyRequest) {
  const token = extractAccessToken(req);
  if (!token) return;

  try {
    const decoded = verifyAccessToken(token);
    // Phiên đã bị thu hồi (logout/đổi mật khẩu) → coi như guest, không throw.
    // Nếu bỏ qua check này, cookie ADMIN đã logout vẫn giữ role ADMIN.
    if (await isSessionRevoked(decoded.userId, decoded.iat)) return;
    // Tài khoản bị khóa → coi như khách vãng lai, không cấp req.user.
    const account = await UserRepository.findById(decoded.userId);
    if (!account || account.status !== 'active') return;
    req.user = { userId: decoded.userId, role: decoded.role };
  } catch {
    // Ignore error for optional auth
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
      return reply.status(403).send({
        success: false,
        message: `Bạn không có quyền thực hiện thao tác này. Yêu cầu role: ${roles.join(', ')}`,
      });
    }
  };
}
