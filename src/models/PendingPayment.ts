import mongoose, { Document, Schema } from 'mongoose';

export interface IPendingPayment extends Document {
  txnRef: string;
  userId: mongoose.Types.ObjectId;
  /** Order đã được tạo sẵn ở bước prepare → đây là nguồn dữ liệu giao hàng duy nhất */
  orderId?: mongoose.Types.ObjectId;
  cartSnapshot: {
    items: any[];
    totalAmount: number;
    totalItems: number;
    voucherCode?: string | null;
    voucherDiscount?: number;
    freeshipVoucherCode?: string | null;
  };
  shippingMethodCode?: string;
  shippingFee: number;
  finalAmount: number;
  /**
   * @deprecated Địa chỉ khách hàng đã nằm trong `Order.shippingInfo`. Giữ lại để
   * tương thích với các bản ghi cũ tạo trước khi gộp pipeline checkout.
   * Not set in new checkout flow - shipping info is on Order.
   */
  customerInfo: {
    fullName?: string;
    email?: string;
    phone?: string;
    address?: string;
    note?: string;
  } | undefined;
  status: 'pending' | 'completed' | 'failed' | 'expired';
  ipAddr?: string;
  clearsCart: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PendingPaymentSchema = new Schema<IPendingPayment>(
  {
    txnRef: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', index: true },
    cartSnapshot: {
      items: [{ type: Schema.Types.Mixed }],
      totalAmount: { type: Number, required: true },
      totalItems: { type: Number, required: true },
      voucherCode: { type: String, default: null },
      voucherDiscount: { type: Number, default: 0 },
      freeshipVoucherCode: { type: String, default: null },
    },
    shippingMethodCode: { type: String, default: 'standard' },
    shippingFee: { type: Number, default: 0 },
    finalAmount: { type: Number, required: true },
    // @deprecated — xem ghi chú ở IPendingPayment.customerInfo.
    customerInfo: {
      fullName: { type: String },
      email: { type: String },
      phone: { type: String },
      address: { type: String },
      note: { type: String },
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'expired'],
      default: 'pending',
      index: true,
    },
    ipAddr: { type: String },
    clearsCart: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: 'pending_payments',
  }
);

// TTL index: tự động xóa sau 60 phút (khớp với vnp_ExpireDate)
PendingPaymentSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3600 });

export const PendingPayment =
  mongoose.models.PendingPayment ||
  mongoose.model<IPendingPayment>('PendingPayment', PendingPaymentSchema);