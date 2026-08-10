import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Kiểm tra user có quyền ADMIN hoặc SUBADMIN không.
 * Trả về false và gửi 403 nếu không có quyền.
 */
export function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  const user = (req as any).user;
  if (!user || (user.role !== 'ADMIN' && user.role !== 'SUBADMIN')) {
    reply.status(403).send({
      success: false,
      message: 'Bạn không có quyền thực hiện hành động này',
    });
    return false;
  }
  return true;
}
