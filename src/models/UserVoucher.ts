import mongoose, { Document, Schema } from 'mongoose';

export interface IUserVoucher extends Document {
  userId: mongoose.Types.ObjectId;
  voucherId: mongoose.Types.ObjectId;
  code: string;
  isUsed: boolean;
  usedAt?: Date;
  grantedReason: 'membership' | 'minigame';
  createdAt: Date;
  updatedAt: Date;
}

const UserVoucherSchema = new Schema<IUserVoucher>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    voucherId: { type: Schema.Types.ObjectId, ref: 'Voucher', required: true, index: true },
    code: { type: String, required: true },
    isUsed: { type: Boolean, default: false, index: true },
    usedAt: { type: Date },
    grantedReason: { type: String, enum: ['membership', 'minigame'], required: true },
  },
  {
    timestamps: true,
    collection: 'user_vouchers',
  }
);

// Indexes
UserVoucherSchema.index({ userId: 1, voucherId: 1 });
UserVoucherSchema.index({ userId: 1, isUsed: 1 });

export const UserVoucher =
  mongoose.models.UserVoucher ||
  mongoose.model<IUserVoucher>('UserVoucher', UserVoucherSchema);
