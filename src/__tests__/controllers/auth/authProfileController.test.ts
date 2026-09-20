import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProfileController } from '../../../controllers/auth/authProfileController.ts';

vi.mock('../../../repositories/UserRepository.ts', () => ({
  UserRepository: {
    findById: vi.fn(),
    update: vi.fn(),
    findByEmail: vi.fn(),
    findByUsername: vi.fn(),
  },
}));

vi.mock('../../../models/User.ts', () => ({
  User: {
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
  },
}));

vi.mock('../../../models/UserAddress.ts', () => ({
  UserAddress: { findOne: vi.fn(() => ({ lean: vi.fn(async () => null) })) },
}));

vi.mock('../../../models/Order.ts', () => ({
  Order: {
    aggregate: vi.fn(),
    find: vi.fn(() => ({
      sort: vi.fn(() => ({ limit: vi.fn(() => ({ lean: vi.fn(async () => []) })) })),
    })),
    countDocuments: vi.fn(),
  },
}));

vi.mock('../../../models/AuditLog.ts', () => ({
  AuditLog: { create: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../../services/ImageService.ts', () => ({
  ImageService: { compressAndUpload: vi.fn(), deleteFromR2: vi.fn() },
}));

vi.mock('../../../utils/auth.ts', () => ({
  hashPassword: vi.fn().mockResolvedValue('new-hash'),
  comparePassword: vi.fn(),
}));

import { UserRepository } from '../../../repositories/UserRepository.ts';
import { User } from '../../../models/User.ts';
import { Order } from '../../../models/Order.ts';
import { UserAddress } from '../../../models/UserAddress.ts';
import { AuditLog } from '../../../models/AuditLog.ts';
import { comparePassword } from '../../../utils/auth.ts';

function makeReply() {
  let statusCode = 200;
  let sentBody: any = {};
  const r: any = {
    status: (c: number) => { statusCode = c; return r; },
    send: (b: any) => { sentBody = b; return r; },
  };
  return { reply: r, getStatus: () => statusCode, getBody: () => sentBody };
}

const req = (body: any) => ({ body, user: { userId: '507f1f77bcf86cd799439011' } } as any);

describe('AuthProfileController.changePassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(UserRepository.update).mockResolvedValue({ _id: '507f1f77bcf86cd799439011' } as any);
  });

  it('sai mật khẩu hiện tại → 400, không ghi gì cả', async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue({ _id: '507f1f77bcf86cd799439011', passwordHash: 'hash' } as any);
    vi.mocked(comparePassword).mockResolvedValue(false);

    const { reply, getStatus } = makeReply();
    await AuthProfileController.changePassword(req({ currentPassword: 'wrong', newPassword: 'abcd1234' }), reply);

    expect(getStatus()).toBe(400);
    expect(UserRepository.update).not.toHaveBeenCalled();
    expect(AuditLog.create).not.toHaveBeenCalled();
  });

  it('OAuth user chưa có mật khẩu → set luôn mật khẩu mới, ghi passwordChangedAt + AuditLog', async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue({ _id: '507f1f77bcf86cd799439011', passwordHash: '' } as any);

    const { reply } = makeReply();
    await AuthProfileController.changePassword(req({ newPassword: 'abcd1234' }), reply);

    expect(UserRepository.update).toHaveBeenCalledWith('507f1f77bcf86cd799439011', expect.objectContaining({
      passwordHash: 'new-hash',
      passwordChangedAt: expect.any(Date),
    }));
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'PASSWORD_CHANGE',
      status: 'SUCCESS',
    }));
  });

  it('đúng mật khẩu hiện tại → hash mật khẩu mới + ghi passwordChangedAt (vô hiệu session cũ)', async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue({ _id: '507f1f77bcf86cd799439011', passwordHash: 'hash' } as any);
    vi.mocked(comparePassword).mockResolvedValue(true);

    const { reply } = makeReply();
    await AuthProfileController.changePassword(req({ currentPassword: 'correct', newPassword: 'abcd1234' }), reply);

    expect(UserRepository.update).toHaveBeenCalledWith('507f1f77bcf86cd799439011', expect.objectContaining({
      passwordChangedAt: expect.any(Date),
    }));
  });
});

describe('AuthProfileController.verifyPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('đúng mật khẩu → 200 success', async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue({ _id: '507f1f77bcf86cd799439011', passwordHash: 'hash' } as any);
    vi.mocked(comparePassword).mockResolvedValue(true);

    const { reply, getStatus, getBody } = makeReply();
    await AuthProfileController.verifyPassword(req({ password: 'oldpass1' }), reply);

    expect(getStatus()).toBe(200);
    expect(getBody().success).toBe(true);
  });

  it('sai mật khẩu → 401', async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue({ _id: '507f1f77bcf86cd799439011', passwordHash: 'hash' } as any);
    vi.mocked(comparePassword).mockResolvedValue(false);

    const { reply, getStatus } = makeReply();
    await AuthProfileController.verifyPassword(req({ password: 'wrong' }), reply);

    expect(getStatus()).toBe(401);
  });

  it('user OAuth chưa có mật khẩu → 400, không so sánh', async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue({ _id: '507f1f77bcf86cd799439011', passwordHash: '' } as any);

    const { reply, getStatus } = makeReply();
    await AuthProfileController.verifyPassword(req({ password: 'anything' }), reply);

    expect(getStatus()).toBe(400);
    expect(comparePassword).not.toHaveBeenCalled();
  });

  it('REGRESSION: verify chỉ so sánh — không được ghi passwordHash/passwordChangedAt (hack cũ làm đăng xuất mọi thiết bị)', async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue({ _id: '507f1f77bcf86cd799439011', passwordHash: 'hash' } as any);
    vi.mocked(comparePassword).mockResolvedValue(true);

    const { reply } = makeReply();
    await AuthProfileController.verifyPassword(req({ password: 'oldpass1' }), reply);

    expect(UserRepository.update).not.toHaveBeenCalled();
    expect(AuditLog.create).not.toHaveBeenCalled();
  });
});

describe('AuthProfileController.updateProfile — normalize + chặn trùng', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(UserRepository.findById).mockResolvedValue({ _id: '507f1f77bcf86cd799439011' } as any);
    vi.mocked(UserRepository.update).mockResolvedValue({ _id: '507f1f77bcf86cd799439011', toObject: () => ({}) } as any);
  });

  it('trim + lowercase email và username trước khi kiểm tra/lưu', async () => {
    vi.mocked(UserRepository.findByEmail).mockResolvedValue(null);
    vi.mocked(UserRepository.findByUsername).mockResolvedValue(null);

    const { reply } = makeReply();
    await AuthProfileController.updateProfile(req({ username: '  NewName  ', email: ' John@X.COM ' }), reply);

    expect(UserRepository.findByEmail).toHaveBeenCalledWith('john@x.com');
    expect(UserRepository.findByUsername).toHaveBeenCalledWith('newname');
    expect(UserRepository.update).toHaveBeenCalledWith('507f1f77bcf86cd799439011', expect.objectContaining({
      username: 'newname',
      email: 'john@x.com',
    }));
  });

  it('username trùng user khác → 400', async () => {
    vi.mocked(UserRepository.findByUsername).mockResolvedValue({ _id: 'other-user' } as any);

    const { reply, getStatus, getBody } = makeReply();
    await AuthProfileController.updateProfile(req({ username: 'taken' }), reply);

    expect(getStatus()).toBe(400);
    expect(UserRepository.update).not.toHaveBeenCalled();
  });

  it('username sai định dạng (chữ hoa/khoảng trắng) → 400', async () => {
    const { reply, getStatus } = makeReply();
    await AuthProfileController.updateProfile(req({ username: 'Bad Name!' }), reply);

    expect(getStatus()).toBe(400);
  });

  it('email trùng user khác → 400 (thông báo tiếng Việt cho FE toast)', async () => {
    vi.mocked(UserRepository.findByEmail).mockResolvedValue({ _id: 'other-user' } as any);

    const { reply, getStatus, getBody } = makeReply();
    await AuthProfileController.updateProfile(req({ email: 'taken@x.com' }), reply);

    expect(getStatus()).toBe(400);
    expect(getBody().message).toContain('đã được sử dụng');
  });

  it('ghi AuditLog PROFILE_UPDATE sau khi cập nhật thành công', async () => {
    vi.mocked(UserRepository.findByUsername).mockResolvedValue(null);

    const { reply } = makeReply();
    await AuthProfileController.updateProfile(req({ fullName: 'Nguyễn Văn A' }), reply);

    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'PROFILE_UPDATE',
      status: 'SUCCESS',
    }));
  });
});

describe('AuthProfileController.getMe — hạng thành viên real-time', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tính memberTier từ tổng chi tiêu đơn đã giao (15tr → Bac)', async () => {
    vi.mocked(User.findById as any).mockReturnValue({
      lean: async () => ({ _id: '507f1f77bcf86cd799439011', username: 'u', passwordHash: 'h', memberTier: 'MEMBER' }),
    });
    vi.mocked(Order.aggregate as any).mockResolvedValue([{ total: 15_000_000 }]);

    const { reply, getBody } = makeReply();
    await AuthProfileController.getMe(req({}), reply);

    expect(getBody().data.memberTier).toBe('Bac');
    expect(getBody().data.totalSpent).toBe(15_000_000);
    expect(getBody().data.hasPassword).toBe(true);
  });

  it('KHÔNG ghi đè memberTier trong DB (bug cũ: mở profile reset hạng về MEMBER)', async () => {
    vi.mocked(User.findById as any).mockReturnValue({
      lean: async () => ({ _id: '507f1f77bcf86cd799439011', username: 'u', passwordHash: '' }),
    });
    vi.mocked(Order.aggregate as any).mockResolvedValue([]);

    const { reply } = makeReply();
    await AuthProfileController.getMe(req({}), reply);

    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});

describe('ChangePasswordSchema — policy 8+chữ+số (đồng bộ register)', () => {
  it('chặn mật khẩu <8 ký tự hoặc thiếu chữ/số', async () => {
    const { ChangePasswordSchema } = await import('../../../types/user.types.ts');
    expect(ChangePasswordSchema.safeParse({ newPassword: '12345678' }).success).toBe(false);
    expect(ChangePasswordSchema.safeParse({ newPassword: 'abcdefgh' }).success).toBe(false);
    expect(ChangePasswordSchema.safeParse({ newPassword: 'abcd1234' }).success).toBe(true);
  });
});
