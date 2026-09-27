import mongoose, { Document, Schema } from 'mongoose';

/**
 * OrderItem — snapshot giá/số lượng tại thời điểm đặt hàng.
 * Dữ liệu sản phẩm không snapshot ở đây: đọc qua productVariantId
 * → ProductVariant.productId → Product (và Brand/ProductImage khi cần).
 */
export interface IOrderItem extends Document {
  orderId: mongoose.Types.ObjectId;
  productVariantId: mongoose.Types.ObjectId;
  quantity: number;
  price: number;
  discount?: number;
  createdAt: Date;
}

const OrderItemSchema = new Schema<IOrderItem>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    productVariantId: { type: Schema.Types.ObjectId, ref: 'ProductVariant', required: true, index: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true },
    discount: { type: Number, default: 0 },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'order_items',
  }
);

OrderItemSchema.index({ productVariantId: 1, createdAt: -1 });

export const OrderItem =
  mongoose.models.OrderItem ||
  mongoose.model<IOrderItem>('OrderItem', OrderItemSchema);
