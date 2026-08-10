import mongoose, { Document, Schema } from 'mongoose';
export interface IOrderItem extends Document {
  orderId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  name: string;
  brand?: string;
  quantity: number;
  price: number;
  discount?: number;
  image?: string;
  variantSize?: string;
  createdAt: Date;
  updatedAt: Date;
}

const OrderItemSchema = new Schema<IOrderItem>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    brand: { type: String },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    image: { type: String },
    variantSize: { type: String },
  },
  {
    timestamps: true,
    collection: 'order_items',
  }
);

OrderItemSchema.index({ brand: 1, createdAt: -1 });

export const OrderItem =
  mongoose.models.OrderItem ||
  mongoose.model<IOrderItem>('OrderItem', OrderItemSchema);
