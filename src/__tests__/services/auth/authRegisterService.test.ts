import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthRegisterService } from '../../../services/auth/authRegisterService.ts';

vi.mock('../../../repositories/UserRepository.ts', () => ({
  UserRepository: {
    findByEmail: vi.fn(),
    findByUsername: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../../../utils/auth.ts', () => ({
  hashPassword: vi.fn(async () => 'hashed'),
  generateTokens: vi.fn(() => ({ accessToken: 'at', refreshToken: 'rt' })),
  toPublicUser: vi.fn((u: any) => ({ id: u._id })),
}));

import { UserRepository } from '../../../repositories/UserRepository.ts';

const input = { username: 'newbie', email: 'Newbie@Example.com ', password: 'Abcd1234' } as any;

describe('AuthRegisterService.register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(UserRepository.findByEmail).mockResolvedValue(null);
    vi.mocked(UserRepository.findByUsername).mockResolvedValue(null);
    vi.mocked(UserRepository.create).mockImplementation(async (u: any) => ({ _id: 'id-1', ...u }) as any);
  });

  it('tra cứu và lưu email đúng một dạng: trim + lowercase', async () => {
    await AuthRegisterService.register(input);

    expect(UserRepository.findByEmail).toHaveBeenCalledWith('newbie@example.com');
    expect(UserRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'newbie@example.com' }),
    );
  });

  it('email đã thuộc tài khoản Google-only → chỉ đường bấm Google, không tạo tài khoản', async () => {
    vi.mocked(UserRepository.findByEmail).mockResolvedValue({
      _id: 'g-1',
      email: 'newbie@example.com',
      oauthProvider: 'google',
      passwordHash: '',
    } as any);

    await expect(AuthRegisterService.register(input)).rejects.toThrow(/hãy đăng nhập bằng Google/);
    expect(UserRepository.create).not.toHaveBeenCalled();
  });

  it('email đã có tài khoản mật khẩu → giữ thông báo chung', async () => {
    vi.mocked(UserRepository.findByEmail).mockResolvedValue({
      _id: 'u-1',
      email: 'newbie@example.com',
      passwordHash: '$2a$10$x',
    } as any);

    await expect(AuthRegisterService.register(input)).rejects.toThrow('Email đã được sử dụng');
    expect(UserRepository.create).not.toHaveBeenCalled();
  });

  it('tài khoản vừa có Google vừa có mật khẩu → không mách đăng nhập Google', async () => {
    vi.mocked(UserRepository.findByEmail).mockResolvedValue({
      _id: 'u-2',
      email: 'newbie@example.com',
      oauthProvider: 'google',
      passwordHash: '$2a$10$x',
    } as any);

    await expect(AuthRegisterService.register(input)).rejects.toThrow('Email đã được sử dụng');
  });

  it('email trùng alias Gmail bị repository trả về → chặn ngay từ đăng ký', async () => {
    // Repository đã tra cả biến thể alias, nên a.b@gmail.com gặp tài khoản ab@gmail.com là trùng.
    vi.mocked(UserRepository.findByEmail).mockResolvedValue({
      _id: 'u-3',
      email: 'ab@gmail.com',
      passwordHash: '$2a$10$x',
    } as any);

    await expect(
      AuthRegisterService.register({ ...input, email: 'a.b@gmail.com' } as any),
    ).rejects.toThrow('Email đã được sử dụng');
    expect(UserRepository.findByEmail).toHaveBeenCalledWith('a.b@gmail.com');
  });
});
