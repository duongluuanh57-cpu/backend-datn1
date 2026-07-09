import mongoose, { Document, Schema } from 'mongoose';
import { multiTenancyPlugin } from '../utils/multiTenancyPlugin.ts';

export interface IReview extends Document {
  userId: mongoose.Types.ObjectId;     // Người review
  productId: mongoose.Types.ObjectId;  // Sản phẩm được review
  orderItemId: mongoose.Types.ObjectId; // OrderItem đã mua (xác thực)
  rating: number;                       // Số sao (1-5)
  comment?: string;                     // Nội dung review
  images?: string[];                    // Ảnh kèm review
  status: 'visible' | 'hidden';        // Admin có thể ẩn/hiện
  createdAt: Date;
  updatedAt: Date;
}

const ReviewSchema = new Schema<IReview>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    orderItemId: { type: Schema.Types.ObjectId, ref: 'OrderItem', required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '' },
    images: [{ type: String }],
    status: { type: String, enum: ['visible', 'hidden'], default: 'visible', index: true },
  },
  {
    timestamps: true,
    collection: 'reviews',
  }
);

// 1 user chỉ review 1 sản phẩm 1 lần duy nhất
ReviewSchema.index({ userId: 1, productId: 1 }, { unique: true });

ReviewSchema.plugin(multiTenancyPlugin);

export const Review =
  mongoose.models.Review ||
  mongoose.model<IReview>('Review', ReviewSchema);