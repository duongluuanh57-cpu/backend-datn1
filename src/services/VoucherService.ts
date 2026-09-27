import { Voucher, type VoucherType } from '../models/Voucher.ts';

/**
 * Voucher dùng chung cho checkout. Membership và minigame không còn là
 * loại voucher; minigame chỉ cộng xu qua RewardService.
 */
export class VoucherService {
  static async getAll() {
    return Voucher.find({}).sort({ createdAt: -1 }).lean();
  }

  static async getActive(_userTier?: string | null, _userId?: string | null) {
    const now = new Date();
    return Voucher.find({
      status: 'active',
      maxUsage: { $gt: 0 },
      $expr: { $lt: [{ $ifNull: ['$usedCount', 0] }, '$maxUsage'] },
      startDate: { $lte: now },
      endDate: { $gte: now },
    }).sort({ createdAt: -1 }).lean();
  }

  static async getById(id: string) {
    return Voucher.findOne({ _id: id }).lean();
  }

  static async create(data: {
    code: string;
    type: VoucherType;
    value: number;
    voucherCategory?: 'discount' | 'freeship';
    minOrderAmount?: number;
    maxDiscount?: number;
    maxUsage: number;
    startDate: string;
    endDate: string;
    status?: 'active' | 'inactive';
  }) {
    // Whitelist tường minh: không spread nguyên body để client không set được
    // usedCount / isPublic ngoài luồng thông thường.
    return Voucher.create({
      code: data.code.toUpperCase(),
      type: data.type,
      value: data.value,
      voucherCategory: data.voucherCategory ?? 'discount',
      minOrderAmount: data.minOrderAmount ?? 0,
      maxDiscount: data.maxDiscount,
      maxUsage: data.maxUsage,
      startDate: data.startDate,
      endDate: data.endDate,
      status: data.status || 'active',
    });
  }

  static async update(id: string, data: Partial<{
    code: string;
    type: VoucherType;
    value: number;
    voucherCategory: 'discount' | 'freeship';
    minOrderAmount: number;
    maxDiscount: number;
    maxUsage: number;
    startDate: string;
    endDate: string;
    status: 'active' | 'inactive';
  }>) {
    const current = await Voucher.findById(id).select('maxUsage usedCount').lean();
    if (!current) return null;

    const updateData: any = {};
    if (data.code !== undefined) updateData.code = data.code.toUpperCase();
    if (data.type !== undefined) updateData.type = data.type;
    if (data.value !== undefined) updateData.value = data.value;
    if (data.voucherCategory !== undefined) updateData.voucherCategory = data.voucherCategory;
    if (data.minOrderAmount !== undefined) updateData.minOrderAmount = data.minOrderAmount;
    if (data.maxDiscount !== undefined) updateData.maxDiscount = data.maxDiscount;
    if (data.startDate !== undefined) updateData.startDate = data.startDate;
    if (data.endDate !== undefined) updateData.endDate = data.endDate;
    if (data.maxUsage !== undefined) updateData.maxUsage = data.maxUsage;
    if (data.status !== undefined) updateData.status = data.status;
    const effectiveMaxUsage = data.maxUsage ?? current.maxUsage;
    if ((current.usedCount || 0) >= effectiveMaxUsage) updateData.status = 'inactive';

    return Voucher.findOneAndUpdate(
      { _id: id },
      { $set: updateData },
      { new: true },
    );
  }

  static async delete(id: string) {
    const result = await Voucher.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }

  static async validate(
    code: string,
    orderAmount: number,
    _userTier?: string | null,
    _userId?: string | null,
  ) {
    const voucher = await Voucher.findOne({
      code: code.toUpperCase(),
    }).lean() as any;
    if (!voucher) return { valid: false, message: 'Mã giảm giá không tồn tại' };
    if (voucher.status !== 'active') return { valid: false, message: 'Mã giảm giá đã bị vô hiệu hoá' };

    const now = new Date();
    if (voucher.startDate > now) return { valid: false, message: 'Mã giảm giá chưa đến hạn sử dụng' };
    if (voucher.endDate < now) return { valid: false, message: 'Mã giảm giá đã hết hạn' };
    if (!Number.isInteger(Number(voucher.maxUsage)) || Number(voucher.maxUsage) <= 0) {
      return { valid: false, message: 'Mã giảm giá không có giới hạn lượt sử dụng hợp lệ' };
    }
    if ((voucher.usedCount || 0) >= Number(voucher.maxUsage)) {
      return { valid: false, message: 'Mã giảm giá đã hết lượt sử dụng' };
    }
    if (orderAmount < (voucher.minOrderAmount || 0)) {
      return {
        valid: false,
        message: `Đơn hàng tối thiểu ${(voucher.minOrderAmount || 0).toLocaleString()}đ để áp dụng mã này`,
      };
    }

    let discountAmount = 0;
    if (voucher.type === 'percentage') {
      discountAmount = Math.round(orderAmount * (voucher.value / 100));
      if (voucher.maxDiscount && discountAmount > voucher.maxDiscount) discountAmount = voucher.maxDiscount;
    } else {
      discountAmount = voucher.value;
    }
    // Không cho mức giảm vượt quá giá trị đơn (chặn voucher cấu hình sai,
    // vd percentage > 100 hoặc fixed value quá lớn).
    discountAmount = Math.max(0, Math.min(discountAmount, orderAmount));

    return { valid: true, message: 'Áp dụng mã giảm giá thành công', voucher, discountAmount };
  }

  static async incrementUsage(id: string) {
    await Voucher.updateOne(
      { _id: id, $expr: { $lt: [{ $ifNull: ['$usedCount', 0] }, '$maxUsage'] } },
      [
        {
          $set: {
            usedCount: { $add: [{ $ifNull: ['$usedCount', 0] }, 1] },
            status: {
              $cond: [
                { $gte: [{ $add: [{ $ifNull: ['$usedCount', 0] }, 1] }, '$maxUsage'] },
                'inactive',
                '$status',
              ],
            },
          },
        },
      ],
    );
  }

  /**
   * Đốt lượt dùng theo kiểu "đặt chỗ" nguyên tử: trả về true nếu thực sự lấy
   * được một lượt (usedCount < maxUsage tại thời điểm update). Dùng TRƯỚC khi
   * tạo đơn để hai đơn đồng tranh lượt cuối chỉ có một đơn thắng.
   */
  static async tryConsume(id: string): Promise<boolean> {
    const res = await Voucher.updateOne(
      { _id: id, $expr: { $lt: [{ $ifNull: ['$usedCount', 0] }, '$maxUsage'] } },
      [
        {
          $set: {
            usedCount: { $add: [{ $ifNull: ['$usedCount', 0] }, 1] },
            status: {
              $cond: [
                { $gte: [{ $add: [{ $ifNull: ['$usedCount', 0] }, 1] }, '$maxUsage'] },
                'inactive',
                '$status',
              ],
            },
          },
        },
      ],
    );
    return res.matchedCount === 1;
  }

  /** Hoàn lại một lượt đã đặt chỗ (khi tạo đơn thất bại sau tryConsume). */
  static async releaseUsage(id: string): Promise<void> {
    await Voucher.updateOne(
      { _id: id, usedCount: { $gt: 0 } },
      { $inc: { usedCount: -1 } },
    );
  }
}
