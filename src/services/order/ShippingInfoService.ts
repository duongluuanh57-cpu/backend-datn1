import mongoose from 'mongoose';
import { User } from '../../models/User.ts';
import { UserAddress } from '../../models/UserAddress.ts';

/**
 * ShippingInfoService — nguồn DUY NHẤT sinh ra thông tin giao hàng của đơn.
 *
 * Kết quả map thẳng vào các cột phẳng của bảng `orders`:
 *   receive_name, address, phone, note
 *
 * Mọi phương thức thanh toán đều đi qua đây nên cùng một địa chỉ cho ra cùng
 * một kết quả (trước đây COD đọc DB còn VNPay tin chuỗi client gửi).
 *
 * Thứ tự ưu tiên: `userAddressId` → địa chỉ `isDefault` → địa chỉ đầu tiên.
 * Chỉ khi user chưa lưu địa chỉ nào mới dùng dữ liệu client gửi (fallback).
 */
export interface ShippingInfoInput {
  /** _id của UserAddress mà user đã chọn ở trang thanh toán */
  userAddressId?: string;
  /** Ghi chú của đơn → cột `note` */
  note?: string;
  /** Fallback khi user chưa có địa chỉ nào đã lưu */
  receiveName?: string;
  phone?: string;
  address?: string;
}

export interface ResolvedShippingInfo {
  receiveName: string;
  phone: string;
  address: string;
  note: string;
  /** Email liên hệ: ưu tiên email của địa chỉ, rồi tới email tài khoản. */
  email: string;
}

export class ShippingInfoService {
  /** Ghép các phần của UserAddress thành một dòng địa chỉ, bỏ phần rỗng. */
  static composeAddress(address: any): string {
    return [address?.address, address?.ward, address?.district, address?.province]
      .map((part) => (part || '').toString().trim())
      .filter(Boolean)
      .join(', ');
  }

  static async resolve(userId: string, input: ShippingInfoInput = {}): Promise<ResolvedShippingInfo> {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Truy vấn thẳng collection user_addresses (không phụ thuộc virtual `addresses`).
    const [user, rows] = await Promise.all([
      User.findById(userObjectId).select('email').lean() as any,
      UserAddress.find({ userId: userObjectId }).lean() as any,
    ]);

    if (!user) {
      const err: any = new Error('Không tìm thấy người dùng');
      err.statusCode = 404;
      throw err;
    }

    const addresses: any[] = (rows || []).filter(Boolean);

    let chosen: any = null;
    if (input.userAddressId && mongoose.Types.ObjectId.isValid(input.userAddressId)) {
      chosen = addresses.find((a) => String(a._id) === String(input.userAddressId)) || null;
    }
    if (!chosen) {
      chosen = addresses.find((a) => a.isDefault) || addresses[0] || null;
    }

    if (chosen) {
      return {
        receiveName: chosen.fullName || input.receiveName || '',
        phone: chosen.phoneNumber || input.phone || '',
        address: ShippingInfoService.composeAddress(chosen),
        note: input.note || '',
        email: chosen.email || user.email || '',
      };
    }

    // Chưa lưu địa chỉ nào → dùng dữ liệu client gửi, nhưng vẫn phải đủ 3 phần bắt buộc.
    // ponytail: nhánh này gần như không tới được từ UI — checkout/page.tsx chặn khi chưa
    // chọn địa chỉ và luôn gửi userAddressId. Nó tồn tại làm safety-net cho lời gọi API
    // trực tiếp (đã cover bởi ShippingInfoService.test.ts). Trần: nếu sau này bỏ bắt buộc
    // userAddressId ở FE thì nhánh này thành đường chính và cần validate chặt hơn.
    const receiveName = (input.receiveName || '').trim();
    const phone = (input.phone || '').trim();
    const address = (input.address || '').trim();

    if (!receiveName || !phone || !address) {
      const err: any = new Error('Vui lòng chọn hoặc thêm địa chỉ giao hàng (họ tên, số điện thoại, địa chỉ)');
      err.statusCode = 400;
      throw err;
    }

    return { receiveName, phone, address, note: input.note || '', email: user.email || '' };
  }
}
