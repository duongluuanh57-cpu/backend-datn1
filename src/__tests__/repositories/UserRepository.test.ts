import { describe, it, expect, vi, beforeEach } from 'vitest';

const findOne = vi.fn();

vi.mock('../../models/User.ts', () => ({
  User: { findOne: (...args: any[]) => findOne(...args) },
}));

import { UserRepository } from '../../repositories/UserRepository.ts';

const query = (value: any) => ({ lean: async () => value });

describe('UserRepository.findByEmail', () => {
  beforeEach(() => {
    findOne.mockReset();
  });

  it('tra bằng chuỗi đã chuẩn hóa và dừng ngay khi thấy', async () => {
    const user = { _id: 'u1', email: 'a@b.com' };
    findOne.mockReturnValueOnce(query(user));

    await expect(UserRepository.findByEmail('  A@B.com ')).resolves.toBe(user);
    expect(findOne).toHaveBeenCalledTimes(1);
    expect(findOne).toHaveBeenCalledWith({ email: 'a@b.com' });
  });

  it('không thấy chuỗi chính xác → tra tiếp bằng regex alias Gmail', async () => {
    const aliased = { _id: 'u2', email: 'a.b@gmail.com' };
    findOne.mockReturnValueOnce(query(null)).mockReturnValueOnce(query(aliased));

    await expect(UserRepository.findByEmail('ab+promo@gmail.com')).resolves.toBe(aliased);
    expect(findOne).toHaveBeenCalledTimes(2);

    const secondFilter = findOne.mock.calls[1][0];
    expect(secondFilter.email).toBeInstanceOf(RegExp);
    expect(secondFilter.email.test('a.b@gmail.com')).toBe(true);
    expect(secondFilter.email.test('a.b@googlemail.com')).toBe(true);
    expect(secondFilter.email.test('ab@yahoo.com')).toBe(false);
  });

  it('không phải Gmail → không có bước tra alias', async () => {
    findOne.mockReturnValueOnce(query(null));

    await expect(UserRepository.findByEmail('a@yahoo.com')).resolves.toBeNull();
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it('không tìm thấy gì → trả null sau khi đã thử cả alias', async () => {
    findOne.mockReturnValueOnce(query(null)).mockReturnValueOnce(query(null));

    await expect(UserRepository.findByEmail('ab@gmail.com')).resolves.toBeNull();
    expect(findOne).toHaveBeenCalledTimes(2);
  });
});
