import mongoose, { Document, Schema } from 'mongoose';

export type VoucherType = 'percentage' | 'fixed';

export interface IVoucher extends Document {
  code: string;
  type: VoucherType;
  value: number;
  voucherCategory: 'discount' | 'freeship';
  minOrderAmount: number;
  maxDiscount?: number;
  /** Số lần sử dụng tối đa; bắt buộc lớn hơn 0. */
  maxUsage: number;
  usedCount: number;
  startDate: Date;
  endDate: Date;
  status: 'active' | 'inactive';
  isPublic?: boolean;
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
    voucherCategory: {
      type: String,
      enum: ['discount', 'freeship'],
      default: 'discount',
      required: true,
      index: true,
    },
    minOrderAmount: { type: Number, default: 0 },
    maxDiscount: { type: Number },
    maxUsage: { type: Number, required: true, min: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
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
  },
);

VoucherSchema.index({ code: 1 }, { unique: true });
VoucherSchema.index({ status: 1, startDate: 1, endDate: 1 });

export const Voucher =
  mongoose.models.Voucher ||
  mongoose.model<IVoucher>('Voucher', VoucherSchema);
