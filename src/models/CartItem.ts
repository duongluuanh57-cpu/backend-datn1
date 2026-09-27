import mongoose, { Schema, Document } from 'mongoose';

/**
 * Cart item – mỗi document là một dòng trong giỏ hàng của một user.
 *
 * Giỏ hàng chỉ dùng DUY NHẤT collection `cart_items`, gồm:
 *   - `_id` (cart_item_id) – Mongo ObjectId mặc định
 *   - `productVariantId`   – FK tới ProductVariant (sản phẩm + dung tích)
 *   - `userId`             – FK tới User sở hữu giỏ hàng
 *   - `quantity`           – số lượng, tối thiểu 1
 *   - `price`              – đơn giá tại thời điểm thêm vào giỏ
 *
 * Không còn `cartId`/`productId`: giỏ hàng được xác định trực tiếp bằng `userId`,
 * mỗi biến thể sản phẩm là một dòng (unique theo `userId` + `productVariantId`).
 * Tên/ảnh/thương hiệu/dung tích KHÔNG lưu ở đây mà populate từ
 * ProductVariant → Product khi cần hiển thị.
 */
export interface ICartItem extends Document {
  userId: mongoose.Types.ObjectId;
  productVariantId: mongoose.Types.ObjectId;
  quantity: number;
  price: number;
}

const CartItemSchema = new Schema<ICartItem>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    productVariantId: { type: Schema.Types.ObjectId, ref: 'ProductVariant', required: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    price: { type: Number, required: true },
  },
  { timestamps: false, collection: 'cart_items' }
);

// Mỗi user chỉ có tối đa một dòng cho mỗi biến thể sản phẩm.
CartItemSchema.index({ userId: 1, productVariantId: 1 }, { unique: true });

// Cascade xóa theo productVariantId (khi xóa product/variant ở productMutationService)
// không kèm userId → không dùng được index compound trên (leftmost-prefix) nên cần
// index riêng, tránh COLLSCAN khi giỏ hàng lớn dần.
CartItemSchema.index({ productVariantId: 1 });

export const CartItem: mongoose.Model<ICartItem> =
  (mongoose.models.CartItem as mongoose.Model<ICartItem>) ||
  mongoose.model<ICartItem>('CartItem', CartItemSchema);

export default CartItem;
