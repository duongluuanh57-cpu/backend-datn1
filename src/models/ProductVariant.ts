import mongoose, { Document, Schema } from 'mongoose';
export interface IProductVariant extends Document {
  productId: mongoose.Types.ObjectId; // Reference to Product
  size: string; // '30ml', '50ml', '100ml', etc.
  price: number;
  quantityInStock: number;
  sku?: string; // Stock Keeping Unit
  isDefault: boolean; // Variant mặc định
  // ERD chỉ có 7 cột: _id, productId, size, price, quantityInStock, sku, isDefault.
  // `type` (decant/fullbox) đã bỏ — luôn suy ra từ size (<50ml = decant, còn lại fullbox)
  // ở tầng format/response, không lưu vật lý.
  // timestamps: false — variant luôn được ghi lại qua syncVariantsPreservingIds khi
  // admin sửa product, không ai đọc createdAt/updatedAt nên bỏ cho khớp ERD.
  // Thứ tự hiển thị suy ra từ `size` (xem bySizeAsc) nên không cần cột sortOrder.
}

const ProductVariantSchema = new Schema<IProductVariant>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    size: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    quantityInStock: { type: Number, default: 0, min: 0 },
    sku: { type: String, default: '', trim: true },
    isDefault: { type: Boolean, default: false },
  },
  {
    timestamps: false,
    collection: 'product_variants',
  }
);

ProductVariantSchema.index({ productId: 1, isDefault: -1 });

export const ProductVariant =
  mongoose.models.ProductVariant ||
  mongoose.model<IProductVariant>('ProductVariant', ProductVariantSchema);
