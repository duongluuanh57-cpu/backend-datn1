import { describe, it, expect } from 'vitest';
import { normalizeEmail, canonicalEmail, gmailAliasRegex } from '../../utils/email.ts';

describe('normalizeEmail', () => {
  it('bỏ khoảng trắng và đưa về lowercase', () => {
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });

  it('chuỗi rỗng không ném lỗi', () => {
    expect(normalizeEmail('')).toBe('');
  });
});

describe('canonicalEmail', () => {
  it('gộp dấu chấm và +tag của Gmail về một dạng', () => {
    expect(canonicalEmail('a.b@gmail.com')).toBe('ab@gmail.com');
    expect(canonicalEmail('ab+promo@gmail.com')).toBe('ab@gmail.com');
    expect(canonicalEmail('a.b+promo@gmail.com')).toBe('ab@gmail.com');
  });

  it('coi googlemail.com là gmail.com', () => {
    expect(canonicalEmail('a.b@googlemail.com')).toBe('ab@gmail.com');
  });

  it('nhà cung cấp khác giữ nguyên dấu chấm — ở đó dấu chấm là ký tự thật', () => {
    expect(canonicalEmail('a.b@yahoo.com')).toBe('a.b@yahoo.com');
    expect(canonicalEmail('a.b@example.com')).toBe('a.b@example.com');
  });

  it('chuỗi không phải email thì trả lại nguyên dạng đã chuẩn hóa', () => {
    expect(canonicalEmail('khong-co-a-cong')).toBe('khong-co-a-cong');
    expect(canonicalEmail('a@')).toBe('a@');
  });
});

describe('gmailAliasRegex', () => {
  it('khớp mọi biến thể của cùng một hộp thư', () => {
    const rx = gmailAliasRegex('a.b+promo@gmail.com')!;

    for (const variant of [
      'ab@gmail.com',
      'a.b@gmail.com',
      'ab+promo@gmail.com',
      'a.b+promo@gmail.com',
      'a.b@googlemail.com',
    ]) {
      expect(rx.test(variant), `${variant} phải khớp`).toBe(true);
    }
  });

  it('không khớp hộp thư khác', () => {
    const rx = gmailAliasRegex('ab@gmail.com')!;

    expect(rx.test('abc@gmail.com')).toBe(false);
    expect(rx.test('xab@gmail.com')).toBe(false);
    expect(rx.test('ab@yahoo.com')).toBe(false);
    expect(rx.test('ab@gmail.com.vn')).toBe(false);
  });

  it('không phải Gmail → null, nơi gọi chỉ còn so khớp chuỗi chính xác', () => {
    expect(gmailAliasRegex('a@yahoo.com')).toBeNull();
    expect(gmailAliasRegex('khong-co-a-cong')).toBeNull();
  });
});
