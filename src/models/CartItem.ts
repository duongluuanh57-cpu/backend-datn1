import mongoose, { Schema, Document } from 'mongoose';

export interface ICartItem extends Document {
  cartId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  name: string;
  image?: string;
  brand?: string;
  price: number;
  discount?: number;
  quantity: number;
  variantSize?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CartItemSchema = new Schema<ICartItem>(
  {
    cartId: { type: Schema.Types.ObjectId, ref: 'Cart', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    image: { type: String },
    brand: { type: String },
    price: { type: Number, required: true },
    discount: { type: Number },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    variantSize: { type: String },
  },
  { timestamps: true }
);

CartItemSchema.index({ cartId: 1 });
CartItemSchema.index({ userId: 1 });
CartItemSchema.index({ cartId: 1, productId: 1, variantSize: 1 }, { unique: true });

export default mongoose.model<ICartItem>('CartItem', CartItemSchema);
