import type { FastifyRequest, FastifyReply } from 'fastify';
import { UserRepository } from '../../repositories/UserRepository.ts';
import ejs from 'ejs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const viewsDir = join(__dirname, '../../views');

function renderEjs(templatePath: string, data: Record<string, any> = {}): string {
  const tmpl = readFileSync(join(viewsDir, templatePath), 'utf-8');
  return ejs.render(tmpl, data, { views: [viewsDir] });
}

function getCommonData(userDoc: any, pageTitle: string, currentPage: string, breadcrumb?: string) {
  const userName = userDoc?.fullName || userDoc?.username || 'Admin';
  return {
    pageTitle,
    currentPage,
    userName,
    userRole: userDoc?.role === 'ADMIN' ? 'Quản trị viên' : 'Nhân viên',
    userInitials: (userName.charAt(0) || 'A').toUpperCase(),
    breadcrumb: breadcrumb || '',
  };
}

export class AdminPageController {
  /**
   * GET /admin — Dashboard tổng quan (client-side fetch từ /api/stats/dashboard)
   */
  static async dashboard(req: FastifyRequest, reply: FastifyReply) {
    const userDoc = await UserRepository.findById((req as any).user?.userId);
    const apiToken = (req as any).token || '';
    const bodyHtml = renderEjs('admin/dashboard.ejs', { apiToken });
    return reply.view('admin/layout.ejs', {
      ...getCommonData(userDoc, 'Dashboard', 'dashboard'),
      body: bodyHtml,
      apiToken,
    });
  }

  // ── Settings ──
  static async settingsPage(req: FastifyRequest, reply: FastifyReply) {
    const u = await getDoc((req as any).user?.userId);
    const body = renderEjs('admin/settings.ejs', {
      env: process.env.NODE_ENV||'development',
      nodeVersion: process.version,
      serverTime: new Date().toLocaleString('vi-VN'),
    });
    return reply.view('admin/layout.ejs', { ...getCommonData(u, 'Cài đặt', 'settings', 'Hệ thống'), body, apiToken: (req as any).token || '' });
  }
  static async settingsSave(req: FastifyRequest, reply: FastifyReply) {
    return reply.redirect('/admin/settings?toast=Đã+lưu+cài+đặt&type=success');
  }

  static async logout(_req: FastifyRequest, reply: FastifyReply) {
    // Xóa cookie bằng cách set expired
    reply.header('Set-Cookie', 'admin_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax');
    return reply.redirect('/api/auth/login');
  }
}

async function getDoc(userId: string) {
  if (!userId) return null;
  return UserRepository.findById(userId);
}
