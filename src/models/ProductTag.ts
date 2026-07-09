import mongoose, { Document, Schema } from 'mongoose';
import { multiTenancyPlugin } from '../utils/multiTenancyPlugin.ts';

/**
 * ProductTag — bảng TRUNG GIAN liên kết Product ↔ Tag (nhiều-nhiều)
 *
 * Thay thế cho mảng tags[] trong Product document.
 * Một sản phẩm có thể có nhiều tag, một tag có thể thuộc nhiều sản phẩm.
 */
export interface IProductTag extends Document {
  productId: mongoose.Types.ObjectId; // Reference to Product
  tagId: mongoose.Types.ObjectId;     // Reference to Tag
  createdAt: Date;
  updatedAt: Date;
}

const ProductTagSchema = new Schema<IProductTag>(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    tagId: {
      type: Schema.Types.ObjectId,
      ref: 'Tag',
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'product_tags',
  }
);

// Một sản phẩm không thể gán cùng một tag hai lần
ProductTagSchema.index({ productId: 1, tagId: 1 }, { unique: true });

ProductTagSchema.plugin(multiTenancyPlugin);

export const ProductTag =
  mongoose.models.ProductTag ||
  mongoose.model<IProductTag>('ProductTag', ProductTagSchema);
