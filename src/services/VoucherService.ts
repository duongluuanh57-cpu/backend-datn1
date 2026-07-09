import { Voucher, type VoucherType } from '../models/Voucher.ts';

export class VoucherService {
  /**
   * Lấy tất cả voucher của tenant
   */
  static async getAll() {
    return Voucher.find({}).sort({ createdAt: -1 }).lean();
  }

  /**
   * Lấy voucher đang hoạt động (còn hạn, còn lượt)
   */
  static async getActive() {
    const now = new Date();
    return Voucher.find({
      status: 'active',
      startDate: { $lte: now },
      endDate: { $gte: now },
    })
      .sort({ createdAt: -1 })
      .lean();
  }

  static async getById(id: string) {
    return Voucher.findOne({ _id: id }).lean();
  }

  static async create(data: {
    code: string;
    type: VoucherType;
    value: number;
    minOrderAmount?: number;
    maxDiscount?: number;
    maxUsage?: number;
    startDate: string;
    endDate: string;
  }) {
    return Voucher.create({
      ...data,
      code: data.code.toUpperCase(),
    });
  }

  static async update(id: string, data: Partial<{
    code: string;
    type: VoucherType;
    value: number;
    minOrderAmount: number;
    maxDiscount: number;
    maxUsage: number;
    startDate: string;
    endDate: string;
    status: 'active' | 'inactive';
  }>) {
    const updateData: any = {};
    if (data.code !== undefined) updateData.code = data.code.toUpperCase();
    if (data.type !== undefined) updateData.type = data.type;
    if (data.value !== undefined) updateData.value = data.value;
    if (data.minOrderAmount !== undefined) updateData.minOrderAmount = data.minOrderAmount;
    if (data.maxDiscount !== undefined) updateData.maxDiscount = data.maxDiscount;
    if (data.maxUsage !== undefined) updateData.maxUsage = data.maxUsage;
    if (data.startDate !== undefined) updateData.startDate = data.startDate;
    if (data.endDate !== undefined) updateData.endDate = data.endDate;
    if (data.status !== undefined) updateData.status = data.status;

    return Voucher.findOneAndUpdate(
      { _id: id },
      { $set: updateData },
      { new: true }
    );
  }

  static async delete(id: string) {
    const result = await Voucher.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }

  /**
   * Validate voucher code: kiểm tra hạn, số lượt, min order
   * Trả về { valid, message, voucher? }
   */
  static async validate(code: string, orderAmount: number) {
    const voucher = await Voucher.findOne({
      code: code.toUpperCase(),
    }).lean();

    if (!voucher) {
      return { valid: false, message: 'Mã giảm giá không tồn tại' };
    }

    if (voucher.status !== 'active') {
      return { valid: false, message: 'Mã giảm giá đã bị vô hiệu hoá' };
    }

    const now = new Date();
    if (voucher.startDate > now) {
      return { valid: false, message: 'Mã giảm giá chưa đến hạn sử dụng' };
    }
    if (voucher.endDate < now) {
      return { valid: false, message: 'Mã giảm giá đã hết hạn' };
    }

    if (voucher.maxUsage > 0 && voucher.usedCount >= voucher.maxUsage) {
      return { valid: false, message: 'Mã giảm giá đã hết lượt sử dụng' };
    }

    if (orderAmount < voucher.minOrderAmount) {
      return {
        valid: false,
        message: `Đơn hàng tối thiểu ${voucher.minOrderAmount.toLocaleString()}đ để áp dụng mã này`,
      };
    }

    // Tính discount
    let discountAmount = 0;
    if (voucher.type === 'percentage') {
      discountAmount = Math.round(orderAmount * (voucher.value / 100));
      if (voucher.maxDiscount && discountAmount > voucher.maxDiscount) {
        discountAmount = voucher.maxDiscount;
      }
    } else {
      discountAmount = voucher.value;
    }

    return { valid: true, message: 'Áp dụng mã giảm giá thành công', voucher, discountAmount };
  }

  /**
   * Tăng usedCount của voucher (gọi khi order thành công)
   */
  static async incrementUsage(id: string) {
    await Voucher.findOneAndUpdate(
      { _id: id },
      { $inc: { usedCount: 1 } }
    );
  }
}