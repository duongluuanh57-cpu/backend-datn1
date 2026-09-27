import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

// Mock 2 model mà ShippingInfoService đọc: User (email tài khoản) + UserAddress (địa chỉ đã lưu)
let mockUser: any = null;
let mockAddresses: any[] = [];

vi.mock('../../models/User.ts', () => ({
  User: {
    findById: vi.fn(() => ({
      select: () => ({
        lean: () => Promise.resolve(mockUser),
      }),
    })),
  },
}));

vi.mock('../../models/UserAddress.ts', () => ({
  UserAddress: {
    find: vi.fn(() => ({
      lean: () => Promise.resolve(mockAddresses),
    })),
  },
}));

import { ShippingInfoService } from '../../services/order/ShippingInfoService.ts';

const USER_ID = new mongoose.Types.ObjectId().toString();
const ADDR_1 = new mongoose.Types.ObjectId();
const ADDR_2 = new mongoose.Types.ObjectId();

const baseAddress = {
  _id: ADDR_1,
  fullName: 'Nguyễn Văn A',
  phoneNumber: '0912345678',
  address: '123 Đường ABC',
  ward: 'Phường Bến Nghé',
  district: 'Quận 1',
  province: 'TP.HCM',
  isDefault: false,
};

describe('ShippingInfoService.resolve', () => {
  beforeEach(() => {
    mockUser = { _id: USER_ID, email: 'acc@example.com', memberTier: 'MEMBER' };
    mockAddresses = [];
  });

  it('dùng đúng địa chỉ theo userAddressId', async () => {
    mockAddresses = [
      { ...baseAddress },
      { ...baseAddress, _id: ADDR_2, fullName: 'Người khác', isDefault: true },
    ];

    const info = await ShippingInfoService.resolve(USER_ID, { userAddressId: ADDR_2.toString() });

    expect(info.receiveName).toBe('Người khác');
  });

  it('fallback về địa chỉ mặc định khi không truyền userAddressId', async () => {
    mockAddresses = [
      { ...baseAddress, lastName: 'Văn' },
      { ...baseAddress, _id: ADDR_2, lastName: 'A', isDefault: true },
    ];

    const info = await ShippingInfoService.resolve(USER_ID, {});

    expect(info.receiveName).toBe('Nguyễn Văn A');
  });

  it('fallback về địa chỉ đầu tiên khi không có địa chỉ mặc định', async () => {
    mockAddresses = [{ ...baseAddress }, { ...baseAddress, _id: ADDR_2, fullName: 'Thứ hai' }];

    const info = await ShippingInfoService.resolve(USER_ID, {});

    expect(info.receiveName).toBe('Nguyễn Văn A');
  });

  it('ghép địa chỉ, bỏ phần rỗng và copy ghi chú', async () => {
    mockAddresses = [{ ...baseAddress, ward: '' }];

    const info = await ShippingInfoService.resolve(USER_ID, { note: 'Giao giờ hành chính' });

    expect(info.address).toBe('123 Đường ABC, Quận 1, TP.HCM');
    expect(info.note).toBe('Giao giờ hành chính');
  });

  it('lấy email tài khoản khi địa chỉ không có email và client không gửi', async () => {
    mockAddresses = [{ ...baseAddress }];

    const info = await ShippingInfoService.resolve(USER_ID, {});

    expect(info.email).toBe('acc@example.com');
  });

  it('dùng dữ liệu client khi user chưa lưu địa chỉ nào', async () => {
    mockAddresses = [];

    const info = await ShippingInfoService.resolve(USER_ID, {
      receiveName: 'Khách Vãng Lai',
      phone: '0900000000',
      address: '99 Đường XYZ',
      note: 'Gọi trước khi giao',
    });

    expect(info.receiveName).toBe('Khách Vãng Lai');
    expect(info.address).toBe('99 Đường XYZ');
    expect(info.note).toBe('Gọi trước khi giao');
  });

  it('báo lỗi 400 khi không có địa chỉ lưu sẵn lẫn dữ liệu client', async () => {
    mockAddresses = [];

    await expect(ShippingInfoService.resolve(USER_ID, {})).rejects.toMatchObject({ statusCode: 400 });
  });

  it('báo lỗi 404 khi không tìm thấy user', async () => {
    mockUser = null;

    await expect(ShippingInfoService.resolve(USER_ID, {})).rejects.toMatchObject({ statusCode: 404 });
  });
});
