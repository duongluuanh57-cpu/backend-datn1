import type { FastifyRequest } from 'fastify';

export function getFrontendUrl(): string {
  const envUrl = process.env.FRONTEND_URL || '';
  if (envUrl) return envUrl.replace(/\/+$/, '');
  const isDev = process.env.NODE_ENV !== 'production';
  return isDev ? 'http://localhost:3000' : 'https://lessence-livid.vercel.app';
}

export function detectFrontendUrl(request: FastifyRequest): string {
  const referer = request.headers.referer || request.headers.origin;
  if (referer && typeof referer === 'string') {
    try {
      const parsed = new URL(referer);
      const origin = `${parsed.protocol}//${parsed.host}`;
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        return origin;
      }
      const allowed = process.env.ALLOWED_ORIGINS || '';
      const isAllowed = allowed.split(',').map(s => s.trim()).some(o => {
        try { return new URL(o).origin === origin; } catch { return false; }
      });
      if (isAllowed) return origin;
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
