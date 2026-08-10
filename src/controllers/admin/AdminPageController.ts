import type { FastifyRequest, FastifyReply } from 'fastify';
import { UserRepository } from '../../repositories/UserRepository.ts';
import { renderEjs, renderAdminPage } from '../../utils/viewHelpers.ts';

export class AdminPageController {
  /**
   * GET /admin — Dashboard tổng quan (client-side fetch từ /api/stats/dashboard)
   */
  static async dashboard(req: FastifyRequest, reply: FastifyReply) {
    const userDoc = await UserRepository.findById((req as any).user?.userId);
    const apiToken = (req as any).token || '';
    const bodyHtml = renderEjs('admin/dashboard.ejs', { apiToken });
    return renderAdminPage(reply, userDoc, 'Dashboard', 'dashboard', bodyHtml, apiToken, 'Tổng quan');
  }

  // ── Settings ──
  static async settingsPage(req: FastifyRequest, reply: FastifyReply) {
    const u = await getDoc((req as any).user?.userId);
    const body = renderEjs('admin/settings.ejs', {
      env: process.env.NODE_ENV||'development',
      nodeVersion: process.version,
      serverTime: new Date().toLocaleString('vi-VN'),
    });
    return renderAdminPage(reply, u, 'Cài đặt', 'settings', body, (req as any).token || '', 'Hệ thống');
  }
  static async settingsSave(req: FastifyRequest, reply: FastifyReply) {
    return reply.redirect('/admin/settings?toast=Đã+lưu+cài+đặt&type=success');
  }

  static async logout(_req: FastifyRequest, reply: FastifyReply) {
    // Xóa cookie bằng cách set expired
    reply.header('Set-Cookie', 'admin_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax');
    return reply.redirect('/login');
  }

  // ── Activity Log ──
  static async activityLog(req: FastifyRequest, reply: FastifyReply) {
    const u = await getDoc((req as any).user?.userId);
    const apiToken = (req as any).token || '';
    const bodyHtml = renderEjs('admin/activity-log.ejs', { apiToken });
    return renderAdminPage(reply, u, 'Nhật ký hoạt động', 'activity-log', bodyHtml, apiToken, 'Tổng quan');
  }

  // ── Architecture Diagram ──
  static async architecture(req: FastifyRequest, reply: FastifyReply) {
    const u = await getDoc((req as any).user?.userId);
    const body = renderEjs('admin/architecture.ejs', {});
    return renderAdminPage(reply, u, 'Kiến trúc Hệ thống', 'architecture', body, (req as any).token || '', 'Hệ thống');
  }
}

async function getDoc(userId: string) {
  if (!userId) return null;
  return UserRepository.findById(userId);
}
