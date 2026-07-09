// Stub retained for single-tenant mode
export function getTenantIds(): string[] {
  return ['default'];
}

export function tenantQuery(): Record<string, any> {
  return {};
}
