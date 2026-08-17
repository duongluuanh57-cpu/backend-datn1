import mongoose, { Document, Schema } from 'mongoose';

export const ASPECT_OPTIONS = {
  quality: 'Chất lượng',
  longevity: 'Độ lưu hương',
  scent: 'Mùi hương',
  value: 'Giá trị',
  packaging: 'Bao bì',
  other: 'Khác',
} as const;

export type AspectName = keyof typeof ASPECT_OPTIONS;

export interface IReviewAspect {
  name: AspectName;
  rating: number;   // 1-5
  comment: string;
}

export interface IReview extends Document {
  userId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  orderItemId?: mongoose.Types.ObjectId;
  rating: number;
  comment?: string;
  aspects: IReviewAspect[];
  images?: string[];
  isAnonymous: boolean;
  status: 'visible' | 'hidden' | 'pending' | 'rejected';
  rejectionReason?: string;
  aiRejected?: boolean;
  moderatedBy?: string;
  moderatedByType?: 'admin' | 'ai' | '';
  createdAt: Date;
  updatedAt: Date;
}

const ReviewAspectSchema = new Schema<IReviewAspect>(
  {
    name: { type: String, required: true, enum: Object.keys(ASPECT_OPTIONS) },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '' },
  },
  { _id: false }
);

const ReviewSchema = new Schema<IReview>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    orderItemId: { type: Schema.Types.ObjectId, ref: 'OrderItem', index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '' },
    aspects: { type: [ReviewAspectSchema], default: [] },
    images: [{ type: String }],
    isAnonymous: { type: Boolean, default: false },
    status: { type: String, enum: ['visible', 'hidden', 'pending', 'rejected'], default: 'pending', index: true },
    rejectionReason: { type: String, default: '' },
    aiRejected: { type: Boolean, default: false },
    moderatedBy: { type: String, default: '' },
    moderatedByType: { type: String, enum: ['admin', 'ai', ''], default: '' },
  },
  {
    timestamps: true,
    collection: 'reviews',
  }
);

ReviewSchema.index({ userId: 1, productId: 1 }, { unique: true });

export const Review =
  mongoose.models.Review ||
  mongoose.model<IReview>('Review', ReviewSchema);