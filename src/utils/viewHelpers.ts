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

// ── Compiled EJS template cache (avoid readFileSync + compile on every request) ──
const isProd = process.env.NODE_ENV === 'production';
const compiledTemplateCache = new Map<string, ejs.TemplateFunction>();

export function renderEjs(templateRelPath: string, data: any): string {
  // Mapping fallback cho các template admin cũ đã được chuyển thư mục
  let targetPath = templateRelPath;
  const legacyMap: Record<string, string> = {
    'admin/layout.ejs': 'admin/common/layout.ejs',
    'admin/dashboard.ejs': 'admin/dashboard/dashboard.ejs',
    'admin/crud/list.ejs': 'admin/crud/list.ejs',
    'admin/supplement-detail.ejs': 'admin/products/supplement-detail.ejs',
    'admin/supplement.ejs': 'admin/products/supplement.ejs',
    'admin/activity-log.ejs': 'admin/activity-log/activity-log.ejs',
    'admin/settings.ejs': 'admin/settings/settings.ejs',
    'admin/architecture.ejs': 'admin/common/architecture.ejs',
    'admin/crud/orders-detail.ejs': 'admin/crud/entity-details/orders-detail.ejs',
    'admin/crud/brand-detail.ejs': 'admin/crud/entity-details/brand-detail.ejs',
    'admin/crud/brand-edit.ejs': 'admin/crud/entity-details/brand-edit.ejs',
    'admin/crud/category-detail.ejs': 'admin/crud/entity-details/category-detail.ejs',
    'admin/crud/category-edit.ejs': 'admin/crud/entity-details/category-edit.ejs',
    'admin/crud/tag-detail.ejs': 'admin/crud/entity-details/tag-detail.ejs',
    'admin/crud/tag-edit.ejs': 'admin/crud/entity-details/tag-edit.ejs',
    'admin/crud/voucher-detail.ejs': 'admin/crud/entity-details/voucher-detail.ejs',
    'admin/crud/voucher-edit.ejs': 'admin/crud/entity-details/voucher-edit.ejs',
    'admin/crud/flash-sale-edit.ejs': 'admin/crud/entity-details/flash-sale-edit.ejs',
    'admin/crud/review-detail.ejs': 'admin/crud/entity-details/review-detail.ejs'
  };

  if (legacyMap[templateRelPath]) {
    targetPath = legacyMap[templateRelPath];
  }

  const p = join(viewsDir, targetPath);

  // Production: dùng compiled template từ cache, dev: luôn đọc lại file
  if (isProd && compiledTemplateCache.has(p)) {
    return compiledTemplateCache.get(p)!(data);
  }

  const src = readFileSync(p, 'utf-8');
  const compiledFn = ejs.compile(src, { filename: p, views: [viewsDir], cache: isProd });
  if (isProd) {
    compiledTemplateCache.set(p, compiledFn);
  }
  return compiledFn(data);
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
      if (refUrl.origin !== backendOrigin) {
        return refUrl.origin;
      }
    } catch {}
  }

  const origin = (request.headers['origin'] as string) || '';
  if (origin) {
    try {
      const url = new URL(origin);
      if (url.origin !== backendOrigin) {
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
  const data = {
    ...getCommonData(userDoc, pageTitle, currentPage, breadcrumb),
    frontendUrl,
    body: bodyHtml,
    apiToken: apiToken || '',
    headerAction: headerAction === null ? null : (headerAction || undefined),
  };
  const html = renderEjs('admin/layout.ejs', data);
  return reply.type('text/html; charset=utf-8').send(html);
}
