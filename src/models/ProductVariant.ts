import mongoose, { Document, Schema } from 'mongoose';
import { multiTenancyPlugin } from '../utils/multiTenancyPlugin.ts';

export interface IProductVariant extends Document {
  productId: mongoose.Types.ObjectId; // Reference to Product
  size: string; // '30ml', '50ml', '100ml', etc.
  price: number;
  quantityInStock: number;
  sku?: string; // Stock Keeping Unit
  isDefault: boolean; // Variant mặc định
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const ProductVariantSchema = new Schema<IProductVariant>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    size: { type: String, required: true },
    price: { type: Number, required: true },
    quantityInStock: { type: Number, default: 0 },
    sku: { type: String },
    isDefault: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'product_variants',
  }
);

ProductVariantSchema.plugin(multiTenancyPlugin);

export const ProductVariant =
  mongoose.models.ProductVariant ||
  mongoose.model<IProductVariant>('ProductVariant', ProductVariantSchema);
