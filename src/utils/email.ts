/**
 * Chuẩn hóa email về đúng dạng lưu trong DB: bỏ khoảng trắng hai đầu + lowercase.
 * Mọi cửa nhận email từ người dùng (đăng ký, đăng nhập, đổi email, hồ sơ Google) đều phải
 * đi qua đây — lưu lệch hoa/thường là cùng một hộp thư nằm ở hai chuỗi khác nhau, và
 * unique index trên `users.email` sẽ không chặn được gì.
 */
export function normalizeEmail(email: string): string {
  return (email || '').trim().toLowerCase();
}

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * Dạng "so trùng" của email. Gmail bỏ qua dấu chấm ở phần local và mọi thứ sau dấu `+`,
 * nên a.b+tag@gmail.com chính là ab@gmail.com; googlemail.com cũng là gmail.com.
 * Nhà cung cấp khác giữ nguyên vì dấu chấm ở đó là ký tự thật (khác hộp thư).
 */
export function canonicalEmail(email: string): string {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf('@');
  if (at <= 0 || at === normalized.length - 1) return normalized;

  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (!GMAIL_DOMAINS.has(domain)) return normalized;

  const withoutTag = local.split('+')[0] ?? '';
  return `${withoutTag.replace(/\./g, '')}@gmail.com`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regex khớp MỌI biến thể alias của cùng một hộp thư Gmail, dùng khi cần tìm user mà
 * không biết họ đã lưu dấu chấm / +tag ở dạng nào.
 * Trả về null khi email không phải Gmail — lúc đó chỉ còn cách so khớp chuỗi chính xác.
 */
export function gmailAliasRegex(email: string): RegExp | null {
  const canonical = canonicalEmail(email);
  const at = canonical.lastIndexOf('@');
  if (at <= 0) return null;

  const local = canonical.slice(0, at);
  const domain = canonical.slice(at + 1);
  if (domain !== 'gmail.com' || !local) return null;

  const body = local.split('').map(escapeRegExp).join('\\.?');
  return new RegExp(`^${body}(\\+[^@]*)?@(gmail\\.com|googlemail\\.com)$`, 'i');
}
