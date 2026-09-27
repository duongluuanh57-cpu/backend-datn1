import mongoose, { Document, Schema } from 'mongoose';
import './Tag.ts';
/**
 * ProductTag — bảng TRUNG GIAN liên kết Product ↔ Tag (nhiều-nhiều)
 *
 * Thay thế cho mảng tags[] trong Product document.
 * Một sản phẩm có thể có nhiều tag, một tag có thể thuộc nhiều sản phẩm.
 *
 * `source` phân biệt link do máy đặt và do người chọn:
 * - 'auto'   : sync theo luật dữ liệu (tagRules) tạo ra, luật đổi là bị gỡ.
 * - 'manual' : admin/AI thẩm định rồi chọn — sync không được phép gỡ.
 */
export interface IProductTag extends Document {
  productId: mongoose.Types.ObjectId; // Reference to Product
  tagId: mongoose.Types.ObjectId;     // Reference to Tag
  source: 'auto' | 'manual';
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
    source: {
      type: String,
      enum: ['auto', 'manual'],
      default: 'auto',
    },
  },
  {
    timestamps: false,
    collection: 'product_tags',
  }
);

// Một sản phẩm không thể gán cùng một tag hai lần
ProductTagSchema.index({ productId: 1, tagId: 1 }, { unique: true });
ProductTagSchema.index({ tagId: 1, productId: 1 });

export const ProductTag =
  mongoose.models.ProductTag ||
  mongoose.model<IProductTag>('ProductTag', ProductTagSchema);
