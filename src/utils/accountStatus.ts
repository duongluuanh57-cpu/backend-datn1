export const INACTIVE_AFTER_MS = 60 * 24 * 60 * 60 * 1000; // 60 ngày không đăng nhập

export function getEffectiveStatus(user: {
  status?: string;
  lastLoginAt?: Date | string;
  createdAt?: Date | string;
}): 'active' | 'inactive' | 'suspended' {
  if (user.status === 'suspended') return 'suspended';
  if (user.status === 'inactive') return 'inactive';

  const lastActive = user.lastLoginAt ?? user.createdAt;
  if (!lastActive) return 'inactive';
  if (Date.now() - new Date(lastActive).getTime() > INACTIVE_AFTER_MS) return 'inactive';
  return 'active';
}
