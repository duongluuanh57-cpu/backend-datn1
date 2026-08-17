import mongoose, { Document, Schema } from 'mongoose';
export interface IShippingInfo {
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  customerEmail?: string;
  latitude?: number;       // Vĩ độ GPS định vị giao hàng
  longitude?: number;      // Kinh độ GPS định vị giao hàng
  note?: string;           // Ghi chú đơn hàng
}

export interface IOrder extends Document {
  userId: mongoose.Types.ObjectId;
  shippingInfo: IShippingInfo;
  itemsSubtotal?: number;  // Tạm tính tổng tiền hàng trước ship & giảm giá
  totalAmount: number;
  shippingMethodId?: mongoose.Types.ObjectId; // Ref → ShippingMethod
  shippingFee?: number;
  voucherId?: mongoose.Types.ObjectId;
  voucherCode?: string;
  voucherDiscount?: number;
  freeshipVoucherId?: mongoose.Types.ObjectId;
  freeshipVoucherCode?: string;
  freeshipDiscount?: number;
  trackingNumber?: string; // Mã vận đơn giao hàng (GHTK/GHN/ViettelPost...)
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  paymentMethod: 'cod' | 'momo' | 'vnpay' | 'VNPAY' | 'banking' | 'card' | 'online';
  paymentStatus: 'unpaid' | 'paid' | 'refunded';

  cancelRequested?: boolean;
  soldCounted?: boolean; // Đã cộng/trừ soldCount của Product chưa
  cancelReason?: 'want_change_voucher' | 'want_change_product' | 'complicated_payment' | 'found_cheaper' | 'changed_mind';
  deliveredAt?: Date;
  cancelledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ShippingInfoSchema = new Schema<IShippingInfo>(
  {
    customerName: { type: String, required: true, trim: true },
    customerPhone: { type: String, default: '', trim: true },
    customerAddress: { type: String, default: '', trim: true },
    customerEmail: { type: String, default: '', trim: true },
    latitude: { type: Number },
    longitude: { type: Number },
    note: { type: String, default: '', trim: true },
  },
  { _id: false }
);

const OrderSchema = new Schema<IOrder>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    shippingInfo: { type: ShippingInfoSchema, required: true },
    itemsSubtotal: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    shippingMethodId: { type: Schema.Types.ObjectId, ref: 'ShippingMethod' },
    shippingFee: { type: Number, default: 0 },
    voucherId: { type: Schema.Types.ObjectId, ref: 'Voucher' },
    voucherCode: { type: String, default: null },
    voucherDiscount: { type: Number, default: 0 },
    freeshipVoucherId: { type: Schema.Types.ObjectId, ref: 'Voucher' },
    freeshipVoucherCode: { type: String, default: null },
    freeshipDiscount: { type: Number, default: 0 },
    trackingNumber: { type: String, default: '', trim: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
      default: 'pending',
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ['cod', 'momo', 'vnpay', 'VNPAY', 'banking', 'card', 'online'],
      default: 'cod',
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'refunded'],
      default: 'unpaid',
      index: true,
    },

    cancelRequested: { type: Boolean, default: false },
    soldCounted: { type: Boolean, default: false },
    cancelReason: {
      type: String,
      enum: ['want_change_voucher', 'want_change_product', 'complicated_payment', 'found_cheaper', 'changed_mind'],
    },
    deliveredAt: { type: Date },
    cancelledAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'orders',
  }
);

OrderSchema.index({ createdAt: -1, status: 1 });

export const Order =
  mongoose.models.Order || mongoose.model<IOrder>('Order', OrderSchema);
