import mongoose, { Document, Schema } from 'mongoose';

export interface IPendingPayment extends Document {
  txnRef: string;
  userId: mongoose.Types.ObjectId;
  cartSnapshot: {
    items: any[];
    totalAmount: number;
    totalItems: number;
    voucherCode?: string | null;
    voucherDiscount?: number;
  };
  shippingFee: number;
  finalAmount: number;
  customerInfo: {
    fullName: string;
    email?: string;
    phone: string;
    address: string;
    note?: string;
  };
  status: 'pending' | 'completed' | 'failed' | 'expired';
  ipAddr?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PendingPaymentSchema = new Schema<IPendingPayment>(
  {
    txnRef: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    cartSnapshot: {
      items: [{ type: Schema.Types.Mixed }],
      totalAmount: { type: Number, required: true },
      totalItems: { type: Number, required: true },
      voucherCode: { type: String, default: null },
      voucherDiscount: { type: Number, default: 0 },
    },
    shippingFee: { type: Number, default: 0 },
    finalAmount: { type: Number, required: true },
    customerInfo: {
      fullName: { type: String, required: true },
      email: { type: String },
      phone: { type: String, required: true },
      address: { type: String, required: true },
      note: { type: String },
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'expired'],
      default: 'pending',
      index: true,
    },
    ipAddr: { type: String },
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