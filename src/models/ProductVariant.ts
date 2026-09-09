import mongoose, { Document, Schema } from 'mongoose';
export interface IProductVariant extends Document {
  productId: mongoose.Types.ObjectId; // Reference to Product
  size: string; // '30ml', '50ml', '100ml', etc.
  price: number;
  quantityInStock: number;
  sku?: string; // Stock Keeping Unit
  isDefault: boolean; // Variant mặc định
  type?: 'decant' | 'fullbox'; // 'decant' (Chiết) | 'fullbox' (Full box)
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const ProductVariantSchema = new Schema<IProductVariant>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    size: { type: String, required: true },
    type: {
      type: String,
      enum: ['decant', 'fullbox'],
      default: function(this: any) {
        if (!this.size) return 'fullbox';
        const num = parseInt(String(this.size).replace(/\D/g, ''), 10) || 0;
        return num > 0 && num < 50 ? 'decant' : 'fullbox';
      },
    },
    price: { type: Number, required: true },
    quantityInStock: { type: Number, default: 0 },
    sku: { type: String, default: '', trim: true },
    isDefault: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'product_variants',
  }
);

ProductVariantSchema.index({ productId: 1, sortOrder: 1, isDefault: -1 });

export const ProductVariant =
  mongoose.models.ProductVariant ||
  mongoose.model<IProductVariant>('ProductVariant', ProductVariantSchema);
