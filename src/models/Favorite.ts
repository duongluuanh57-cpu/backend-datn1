import mongoose, { Document, Schema } from 'mongoose';

// timestamps: false → KHÔNG có createdAt/updatedAt. Thứ tự "mới nhất" suy ra từ
// _id (ObjectId tăng đơn điệu theo thời gian) khi cần sort.
export interface IFavorite extends Document {
  userId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
}

const FavoriteSchema = new Schema<IFavorite>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  },
  {
    // Không cần timestamps vì không cần thông tin tạo / sửa đổi cho favorite.
    timestamps: false,
    collection: 'favorites',
  }
);

// Unique compound index: one user can only favorite a product once
FavoriteSchema.index({ userId: 1, productId: 1 }, { unique: true });

export const Favorite = mongoose.models.Favorite || mongoose.model<IFavorite>('Favorite', FavoriteSchema);