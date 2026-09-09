import mongoose, { Document, Schema } from 'mongoose';
export type VoucherType = 'percentage' | 'fixed';
export type VoucherScope = 'all' | 'membership' | 'minigame';

export interface IVoucher extends Document {
  code: string;              // Mã giảm giá, VD: "SALE50", "WELCOME10"
  type: VoucherType;         // percentage: giảm theo %, fixed: giảm số tiền cố định
  value: number;             // percentage: 10 = 10%, fixed: 50000 = 50.000đ
  applicableTo: VoucherScope; // Phân loại voucher: all (toàn sàn), membership (hạng thành viên), minigame (mini game)
  voucherCategory: 'discount' | 'freeship'; // Phân loại: discount (giảm giá tiền), freeship (miễn phí vận chuyển)
  minTier?: string;          // Hạng tối thiểu: null = ai cũng dùng, VD: 'MEMBER', 'Bac', 'Vang', 'KimCuong'
  minOrderAmount: number;    // Đơn hàng tối thiểu để áp dụng
  maxDiscount?: number;      // Giảm tối đa (chỉ dùng cho percentage)
  maxUsage: number;          // Số lần sử dụng tối đa (0 = hết lượt/không khả dụng)
  usedCount: number;         // Số lần đã sử dụng
  startDate: Date;
  endDate: Date;
  validityDays?: number;     // Số ngày có hiệu lực kể từ khi nhận (0/null = dùng startDate/endDate cố định)
  status: 'active' | 'inactive';
  isPublic?: boolean;        // true = hiển thị công khai ở trang voucher
  createdAt: Date;
  updatedAt: Date;
}

const VoucherSchema = new Schema<IVoucher>(
  {
    code: { type: String, required: true, uppercase: true },
    type: {
      type: String,
      required: true,
      enum: ['percentage', 'fixed'],
    },
    value: { type: Number, required: true },
    applicableTo: {
      type: String,
      enum: ['all', 'membership', 'minigame'],
      default: 'all',
      required: true,
      index: true,
    },
    voucherCategory: {
      type: String,
      enum: ['discount', 'freeship'],
      default: 'discount',
      required: true,
      index: true,
    },
    minTier: { type: String, default: null },
    minOrderAmount: { type: Number, default: 0 },
    maxDiscount: { type: Number },
    maxUsage: { type: Number, default: 0 }, // 0 = unlimited
    usedCount: { type: Number, default: 0 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    validityDays: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      index: true,
    },
    isPublic: { type: Boolean, default: true, index: true },
  },
  {
    timestamps: true,
    collection: 'vouchers',
  }
);

// Mỗi voucher code là duy nhất
VoucherSchema.index({ code: 1 }, { unique: true });
VoucherSchema.index({ status: 1, startDate: 1, endDate: 1 });

export const Voucher =
  mongoose.models.Voucher ||
  mongoose.model<IVoucher>('Voucher', VoucherSchema);