import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserController } from '../../../controllers/UserController.ts';
import { AppError, ValidationError } from '../../../utils/errors.ts';

vi.mock('../../../models/CartItem.ts', () => ({
  default: { deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }) },
  CartItem: { deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }) },
}));

vi.mock('../../../models/Order.ts', () => ({
  Order: {
    find: vi.fn(() => ({
      sort: vi.fn(() => ({ limit: vi.fn(() => ({ lean: vi.fn(async () => []) })) })),
    })),
    countDocuments: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../../repositories/UserRepository.ts', () => ({
  UserRepository: {
    findById: vi.fn(),
    update: vi.fn(),
    findByEmail: vi.fn(),
    findByUsername: vi.fn(),
    create: vi.fn(),
  },
}));

import { UserRepository } from '../../../repositories/UserRepository.ts';
import CartItem from '../../../models/CartItem.ts';

function reply() {
  let statusCode = 200;
  let sentBody: any = {};
  const r: any = {
    status: (c: number) => { statusCode = c; return r; },
    send: (b: any) => { sentBody = b; return r; },
  };
  return { reply: r, getStatus: () => statusCode, getBody: () => sentBody };
}

const ADMIN_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439012';
const OTHER_ADMIN_ID = '507f1f77bcf86cd799439013';

const adminUser: any = { _id: ADMIN_ID, username: 'boss', email: 'a@a.com', role: 'ADMIN', status: 'active' };
const normalUser: any = { _id: USER_ID, username: 'u1', email: 'u@u.com', role: 'USER', status: 'active', passwordHash: 'h' };

describe('UserController.updateUser — khóa tài khoản (lock-only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('khóa USER bằng status=suspended → 200', async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue(normalUser);
    vi.mocked(UserRepository.update).mockResolvedValue({ ...normalUser, status: 'suspended', toObject: () => ({ ...normalUser, status: 'suspended' }) } as any);
    const req = { params: { id: USER_ID }, body: { status: 'suspended' }, user: { userId: ADMIN_ID } } as any;
    const { reply: rep, getStatus, getBody } = reply();

    await UserController.updateUser(req, rep);

    expect(getStatus()).toBe(200);
    expect(UserRepository.update).toHaveBeenCalledWith(USER_ID, { status: 'suspended' });
    expect(getBody().data.passwordHash).toBeUndefined();
  });

  it('không cho admin khác sửa ADMIN → 403', async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue(adminUser);
    const req = { params: { id: ADMIN_ID }, body: {}, user: { userId: OTHER_ADMIN_ID } } as any;
    const { reply: rep } = reply();

    await expect(UserController.updateUser(req, rep)).rejects.toThrow(AppError);
    expect(UserRepository.update).not.toHaveBeenCalled();
  });

  it('không cho khóa ADMIN (kể cả tự khóa) → 403', async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue(adminUser);
    const req = { params: { id: ADMIN_ID }, body: { status: 'suspended' }, user: { userId: ADMIN_ID } } as any;
    const { reply: rep } = reply();

    await expect(UserController.updateUser(req, rep)).rejects.toThrow(AppError);
    expect(UserRepository.update).not.toHaveBeenCalled();
  });

  it('không cho đổi role của ADMIN → 403', async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue(adminUser);
    const req = { params: { id: ADMIN_ID }, body: { role: 'USER' }, user: { userId: ADMIN_ID } } as any;
    const { reply: rep } = reply();

    await expect(UserController.updateUser(req, rep)).rejects.toThrow(AppError);
    expect(UserRepository.update).not.toHaveBeenCalled();
  });

  it('user không tồn tại → 404', async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue(null);
    const req = { params: { id: USER_ID }, body: { status: 'suspended' }, user: { userId: ADMIN_ID } } as any;
    const { reply: rep } = reply();

    await expect(UserController.updateUser(req, rep)).rejects.toThrow(AppError);
    expect(UserRepository.update).not.toHaveBeenCalled();
  });

  it('cho nâng USER lên ADMIN qua PATCH (đường duy nhất) → 200', async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue(normalUser);
    vi.mocked(UserRepository.update).mockResolvedValue({ ...normalUser, role: 'ADMIN', toObject: () => ({ ...normalUser, role: 'ADMIN' }) } as any);
    const req = { params: { id: USER_ID }, body: { role: 'ADMIN' }, user: { userId: ADMIN_ID } } as any;
    const { reply: rep, getStatus } = reply();

    await UserController.updateUser(req, rep);

    expect(getStatus()).toBe(200);
    expect(UserRepository.update).toHaveBeenCalledWith(USER_ID, { role: 'ADMIN' });
  });
});

describe('UserController.updateUser — I6 dọn giỏ hàng khi khóa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('chuyển active → suspended → xóa cart_items của user', async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue(normalUser);
    vi.mocked(UserRepository.update).mockResolvedValue({ ...normalUser, status: 'suspended', toObject: () => ({ ...normalUser, status: 'suspended' }) } as any);
    const req = { params: { id: USER_ID }, body: { status: 'suspended' }, user: { userId: ADMIN_ID } } as any;
    const { reply: rep } = reply();

    await UserController.updateUser(req, rep);

    expect(CartItem.deleteMany).toHaveBeenCalledWith({ userId: USER_ID });
  });

  it('update không đổi status → KHÔNG đụng cart_items', async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue(normalUser);
    vi.mocked(UserRepository.update).mockResolvedValue({ ...normalUser, toObject: () => ({ ...normalUser }) } as any);
    const req = { params: { id: USER_ID }, body: { username: 'đổi tên' }, user: { userId: ADMIN_ID } } as any;
    const { reply: rep } = reply();

    await UserController.updateUser(req, rep);

    expect(CartItem.deleteMany).not.toHaveBeenCalled();
  });

  it('user đã suspended sẵn, set suspended lại → KHÔNG xóa lại (idempotent)', async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue({ ...normalUser, status: 'suspended' });
    vi.mocked(UserRepository.update).mockResolvedValue({ ...normalUser, status: 'suspended', toObject: () => ({ ...normalUser, status: 'suspended' }) } as any);
    const req = { params: { id: USER_ID }, body: { status: 'suspended' }, user: { userId: ADMIN_ID } } as any;
    const { reply: rep } = reply();

    await UserController.updateUser(req, rep);

    expect(CartItem.deleteMany).not.toHaveBeenCalled();
  });
});

describe('UpdateUserSchema — validate enum ở route', () => {
  it('từ chối role/status rác và body rỗng', async () => {
    const { UpdateUserSchema } = await import('../../../types/user.types.ts');
    expect(UpdateUserSchema.safeParse({ status: 'banned' }).success).toBe(false);
    expect(UpdateUserSchema.safeParse({ status: 'inactive' }).success).toBe(false);
    expect(UpdateUserSchema.safeParse({ role: 'SUPERUSER' }).success).toBe(false);
    expect(UpdateUserSchema.safeParse({}).success).toBe(false);
    expect(UpdateUserSchema.safeParse({ status: 'suspended' }).success).toBe(true);
  });
});

describe('UserController.createUser', () => {
  it('email trùng → 400 ValidationError', async () => {
    const { UserRepository: repo } = await import('../../../repositories/UserRepository.ts');
    vi.mocked(repo.findByEmail).mockResolvedValue(normalUser);
    const req = { body: { username: 'new', email: 'dup@x.com', password: '123456' } } as any;
    const { reply: rep } = reply();

    await expect(UserController.createUser(req, rep)).rejects.toThrow(ValidationError);
  });
});

describe('UserController.getUserById — chỉ số thật thay vì hardcode', () => {
  it('trả memberTier tính từ tổng chi tiêu + deliveredOrdersCount thật', async () => {
    const { Order } = await import('../../../models/Order.ts');
    const hexId = '507f1f77bcf86cd799439011';
    vi.mocked(UserRepository.findById).mockResolvedValue({ ...normalUser, _id: hexId });
    // Mock theo filter — khong phu thuoc thu goi
    (Order.countDocuments as any).mockImplementation(async (filter: any) =>
      filter?.status === 'delivered' ? 7 : 12
    );
    vi.mocked(Order.aggregate as any).mockResolvedValue([{ total: 25_000_000 }]); // Vang

    const req = { params: { id: hexId } } as any;
    const { reply: rep, getBody } = reply();
    await UserController.getUserById(req, rep);

    expect(getBody().data.memberTier).toBe('Vang');
    expect(getBody().data.deliveredOrdersCount).toBe(7);
    expect(getBody().data.totalOrdersCount).toBe(12);
    expect(getBody().data.totalSpent).toBe(25_000_000);
  });
});

describe('UserController.createUser — normalize', () => {
  it('lowercase email/username trước khi check trùng và lưu', async () => {
    const { UserRepository: repo } = await import('../../../repositories/UserRepository.ts');
    vi.mocked(repo.findByEmail).mockResolvedValue(null);
    vi.mocked(repo.findByUsername).mockResolvedValue(null);
    vi.mocked(repo.create).mockResolvedValue({
      _id: 'new1', username: 'newadmin', email: 'admin@x.com', role: 'ADMIN',
      toObject: () => ({ _id: 'new1', username: 'newadmin', email: 'admin@x.com', role: 'ADMIN' }),
    } as any);

    const req = { body: { username: 'NewAdmin', email: 'Admin@X.COM', password: 'abcd1234' } } as any;
    const { reply: rep, getStatus } = reply();
    await UserController.createUser(req, rep);

    expect(repo.findByEmail).toHaveBeenCalledWith('admin@x.com');
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      username: 'newadmin',
      email: 'admin@x.com',
    }));
    expect(getStatus()).toBe(200);
  });
});

describe('CreateAdminSchema — password policy 8+chữ+số', () => {
  it('chặn mật khẩu <8 ký tự hoặc thiếu chữ/số', async () => {
    const { CreateAdminSchema } = await import('../../../types/user.types.ts');
    expect(CreateAdminSchema.safeParse({ username: 'admin', email: 'a@x.com', password: '123456' }).success).toBe(false);
    expect(CreateAdminSchema.safeParse({ username: 'admin', email: 'a@x.com', password: 'abcdefgh' }).success).toBe(false);
    expect(CreateAdminSchema.safeParse({ username: 'admin', email: 'a@x.com', password: 'abcd1234' }).success).toBe(true);
  });
});
