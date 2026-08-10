import mongoose, { Document, Schema } from 'mongoose';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export interface IPayment extends Document {
  orderId: mongoose.Types.ObjectId;
  paymentMethodId?: mongoose.Types.ObjectId;
  method: string;
  status: PaymentStatus;
  transactionCode?: string;
  txnRef?: string;
  bankCode?: string;
  payDate?: string;
  paidAt?: Date;
  refundedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    paymentMethodId: { type: Schema.Types.ObjectId, ref: 'PaymentMethod', index: true },
    method: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
      index: true,
    },
    transactionCode: { type: String },
    txnRef: { type: String, sparse: true, index: true },
    bankCode: { type: String },
    payDate: { type: String },
    paidAt: { type: Date },
    refundedAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'payments',
  }
);

export const Payment =
  mongoose.models.Payment ||
  mongoose.model<IPayment>('Payment', PaymentSchema);