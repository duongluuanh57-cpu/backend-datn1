import mongoose, { Document, Schema } from 'mongoose';
import { multiTenancyPlugin } from '../utils/multiTenancyPlugin.ts';

export interface IProductImage extends Document {
  productId: mongoose.Types.ObjectId;
  url: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProductImageSchema = new Schema<IProductImage>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    url: { type: String, required: true },
  },
  {
    timestamps: true,
    collection: 'product_images',
  }
);

ProductImageSchema.plugin(multiTenancyPlugin);

export const ProductImage =
  mongoose.models.ProductImage ||
  mongoose.model<IProductImage>('ProductImage', ProductImageSchema);
