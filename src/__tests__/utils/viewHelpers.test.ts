import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getCommonData } from '../../utils/viewHelpers.ts';

describe('getCommonData', () => {
  beforeEach(() => {
    vi.stubEnv('FRONTEND_URL', 'https://frontend-datn-tau.vercel.app');
  });

  const userDoc = {
    fullName: 'Nguyen Van A',
    username: 'nguyena',
    role: 'ADMIN',
  };

  it('returns correct data with all fields', () => {
    const result = getCommonData(userDoc, 'Trang chủ', 'dashboard', 'Admin > Dashboard');
    expect(result).toEqual({
      pageTitle: 'Trang chủ',
      currentPage: 'dashboard',
      userName: 'Nguyen Van A',
      userRole: 'Quản trị viên',
      userInitials: 'N',
      breadcrumb: 'Admin > Dashboard',
      frontendUrl: 'https://frontend-datn-tau.vercel.app',
    });
  });

  it('uses fullName over username', () => {
    const result = getCommonData(userDoc, 'Page', 'p');
    expect(result.userName).toBe('Nguyen Van A');
  });

  it('falls back to username when fullName missing', () => {
    const doc = { username: 'johndoe', role: 'USER' };
    const result = getCommonData(doc, 'Page', 'p');
    expect(result.userName).toBe('johndoe');
  });

  it('falls back to Admin when no name fields', () => {
    const result = getCommonData({ role: 'USER' }, 'Page', 'p');
    expect(result.userName).toBe('Admin');
    expect(result.userInitials).toBe('A');
  });

  it('returns Nhân viên for non-ADMIN role', () => {
    const result = getCommonData({ ...userDoc, role: 'ADMIN' }, 'Page', 'p');
    expect(result.userRole).toBe('Nhân viên');
  });

  it('defaults breadcrumb to empty string', () => {
    const result = getCommonData(userDoc, 'Page', 'p');
    expect(result.breadcrumb).toBe('');
  });
});
