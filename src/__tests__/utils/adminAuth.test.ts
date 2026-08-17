import { describe, it, expect, vi } from 'vitest';
import { requireAdmin } from '../../utils/adminAuth.ts';

function fakeReq(user?: { role?: string }) {
  return { user } as any;
}

function fakeReply() {
  const reply: any = {
    _status: 0,
    _body: null,
    status(s: number) { reply._status = s; return reply; },
    send(b: any) { reply._body = b; return reply; },
  };
  return reply;
}

describe('requireAdmin', () => {
  it('returns true for ADMIN role', () => {
    const req = fakeReq({ role: 'ADMIN' });
    const reply = fakeReply();
    expect(requireAdmin(req, reply)).toBe(true);
  });

  it('returns true for ADMIN role', () => {
    const req = fakeReq({ role: 'ADMIN' });
    const reply = fakeReply();
    expect(requireAdmin(req, reply)).toBe(true);
  });

  it('returns false and sends 403 for USER role', () => {
    const req = fakeReq({ role: 'USER' });
    const reply = fakeReply();
    expect(requireAdmin(req, reply)).toBe(false);
    expect(reply._status).toBe(403);
    expect(reply._body).toEqual({
      success: false,
      message: 'Bạn không có quyền thực hiện hành động này',
    });
  });

  it('returns false and sends 403 when user is undefined', () => {
    const req = fakeReq(undefined);
    const reply = fakeReply();
    expect(requireAdmin(req, reply)).toBe(false);
    expect(reply._status).toBe(403);
  });

  it('returns false and sends 403 when user has no role', () => {
    const req = fakeReq({ role: undefined });
    const reply = fakeReply();
    expect(requireAdmin(req, reply)).toBe(false);
    expect(reply._status).toBe(403);
  });
});
