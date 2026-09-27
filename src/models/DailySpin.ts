import mongoose, { Document, Schema } from 'mongoose';

/**
 * Quyền lượt quay theo ngày của một user.
 * Mỗi user có tối đa một document cho mỗi ngày Việt Nam.
 * Lượt quay từ hạng thành viên và lượt miễn phí đều hết hạn khi sang ngày mới.
 */
export interface IDailySpin extends Document {
  userId: mongoose.Types.ObjectId;
  day: string;
  remaining: number;
  freeGranted: boolean;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DailySpinSchema = new Schema<IDailySpin>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    day: { type: String, required: true },
    remaining: { type: Number, default: 0, min: 0 },
    freeGranted: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    collection: 'daily_spins',
  },
);

// Một user chỉ có một balance lượt quay cho mỗi ngày.
DailySpinSchema.index({ userId: 1, day: 1 }, { unique: true });
// MongoDB TTL chỉ dọn tài liệu sau hết hạn; logic nghiệp vụ vẫn kiểm tra `day`.
DailySpinSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const DailySpin =
  mongoose.models.DailySpin ||
  mongoose.model<IDailySpin>('DailySpin', DailySpinSchema);
