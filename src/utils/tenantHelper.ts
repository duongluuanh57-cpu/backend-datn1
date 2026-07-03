/**
 * Tenant helper — đảm bảo query được cả dữ liệu cũ (default-tenant) và mới (default).
 * Vấn đề: brand/product cũ có tenantId "default-tenant", mới có "default".
 * Hàm này trả về mảng tenantIds để dùng với $in.
 */
export function getTenantIds(tenantId: string): string[] {
  const ids = [tenantId];
  if (tenantId === 'default') ids.push('default-tenant');
  if (tenantId === 'default-tenant') ids.push('default');
  return ids;
}

/**
 * Trả về điều kiện query cho tenantId (dùng với $in).
 * Ví dụ: const query = { ...tenantQuery(tenantId), status: 'active' };
 */
export function tenantQuery(tenantId: string): { tenantId: { $in: string[] } } {
  return { tenantId: { $in: getTenantIds(tenantId) } };
}

/**
 * Chuẩn hóa tenantId về 1 giá trị duy nhất "default".
 * Tất cả "default-tenant" cũ sẽ được chuyển thành "default".
 * Dùng ở middleware để đảm bảo mọi request đều có tenantId nhất quán.
 */
export function normalizeTenant(tid?: string): string {
  if (!tid || tid === 'default-tenant') return 'default';
  return tid;
}
