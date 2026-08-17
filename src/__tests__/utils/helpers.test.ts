import { describe, it, expect } from 'vitest';
import {
  getUserId,
  getClientIp,
  calculateShippingFee,
  FREE_SHIP_THRESHOLD,
  SHIPPING_FEE,
} from '../../utils/helpers.ts';

function fakeReq(overrides: Record<string, any> = {}) {
  return { user: undefined, headers: {}, ip: '127.0.0.1', ...overrides } as any;
}

describe('getUserId', () => {
  it('returns userId when present', () => {
    const req = fakeReq({ user: { userId: 'abc123' } });
    expect(getUserId(req)).toBe('abc123');
  });

  it('returns null when user is undefined', () => {
    expect(getUserId(fakeReq())).toBeNull();
  });

  it('returns null when userId is missing', () => {
    expect(getUserId(fakeReq({ user: { role: 'ADMIN' } }))).toBeNull();
  });
});

describe('getClientIp', () => {
  it('returns first IP from x-forwarded-for string', () => {
    const req = fakeReq({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('returns first IP from x-forwarded-for array', () => {
    const req = fakeReq({ headers: { 'x-forwarded-for': ['9.8.7.6', '5.4.3.2'] } });
    expect(getClientIp(req)).toBe('9.8.7.6');
  });

  it('trims whitespace from forwarded IP', () => {
    const req = fakeReq({ headers: { 'x-forwarded-for': '  10.0.0.1  ' } });
    expect(getClientIp(req)).toBe('10.0.0.1');
  });

  it('falls back to req.ip', () => {
    const req = fakeReq({ ip: '192.168.1.1' });
    expect(getClientIp(req)).toBe('192.168.1.1');
  });

  it('normalizes ::1 to 127.0.0.1', () => {
    const req = fakeReq({ ip: '::1' });
    expect(getClientIp(req)).toBe('127.0.0.1');
  });

  it('defaults to 127.0.0.1 when no ip', () => {
    const req = fakeReq({ ip: undefined });
    expect(getClientIp(req)).toBe('127.0.0.1');
  });
});

describe('calculateShippingFee', () => {
  it('returns 0 when amount >= threshold', async () => {
    const res1 = await calculateShippingFee(FREE_SHIP_THRESHOLD);
    expect(res1.fee).toBe(0);
    const res2 = await calculateShippingFee(1_000_000);
    expect(res2.fee).toBe(0);
  });

  it('returns SHIPPING_FEE when amount < threshold', async () => {
    const res1 = await calculateShippingFee(0);
    expect(res1.fee).toBe(SHIPPING_FEE);
    const res2 = await calculateShippingFee(FREE_SHIP_THRESHOLD - 1);
    expect(res2.fee).toBe(SHIPPING_FEE);
  });

  it('exports correct constants', () => {
    expect(FREE_SHIP_THRESHOLD).toBe(500_000);
    expect(SHIPPING_FEE).toBe(30_000);
  });
});
