import ejs from 'ejs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import type { FastifyReply, FastifyRequest } from 'fastify';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function resolveViewsDir(): string {
  const candidates = [
    join(process.cwd(), 'src/views'),
    join(process.cwd(), 'dist/views'),
    join(__dirname, '../views'),
    join(__dirname, 'views'),
    join(__dirname, '../src/views'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

const viewsDir = resolveViewsDir();

export function renderEjs(templatePath: string, data: Record<string, any> = {}): string {
  const tmpl = readFileSync(join(viewsDir, templatePath), 'utf-8');
  return ejs.render(tmpl, data, { views: [viewsDir] });
}

export function getFrontendUrl(): string {
  return process.env.FRONTEND_URL || 'https://frontend-datn-tau.vercel.app';
}

export function detectFrontendUrl(request: FastifyRequest): string {
  const hostHeader = request.headers['host'] || request.hostname;
  const proto = request.protocol || 'http';
  const backendOrigin = `${proto}://${hostHeader}`;

  const referer = (request.headers['referer'] as string) || (request.headers['referrer'] as string) || '';
  if (referer) {
    try {
      const refUrl = new URL(referer);
      if ((refUrl.hostname === 'localhost' || refUrl.hostname === '127.0.0.1') && refUrl.origin !== backendOrigin) {
        return refUrl.origin;
      }
    } catch {}
  }

  const origin = (request.headers['origin'] as string) || '';
  if (origin) {
    try {
      const url = new URL(origin);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        return url.origin;
      }
    } catch {}
  }

  if (request.hostname === 'localhost' || request.hostname === '127.0.0.1') {
    const allowed = process.env.ALLOWED_ORIGINS || '';
    const found = allowed.split(',').map(s => s.trim()).find(o => {
      try { const u = new URL(o); return u.hostname === 'localhost' || u.hostname === '127.0.0.1'; } catch { return false; }
    });
    if (found) return found;
  }

  return getFrontendUrl();
}

export function getCommonData(userDoc: any, pageTitle: string, currentPage: string, breadcrumb?: string) {
  const userName = userDoc?.fullName || userDoc?.username || 'Admin';
  return {
    pageTitle,
    currentPage,
    userName,
    userRole: userDoc?.role === 'ADMIN' ? 'Quản trị viên' : 'Nhân viên',
    userInitials: (userName.charAt(0) || 'A').toUpperCase(),
    breadcrumb: breadcrumb || '',
    frontendUrl: getFrontendUrl(),
  };
}

export async function renderAdminPage(reply: FastifyReply, userDoc: any, pageTitle: string, currentPage: string, bodyHtml: string, apiToken?: string, breadcrumb?: string, headerAction?: { label: string; href: string; icon?: string } | null) {
  const frontendUrl = detectFrontendUrl(reply.request);
  return reply.view('admin/layout.ejs', {
    ...getCommonData(userDoc, pageTitle, currentPage, breadcrumb),
    frontendUrl,
    body: bodyHtml,
    apiToken: apiToken || '',
    headerAction: headerAction === null ? null : (headerAction || undefined),
  });
}
