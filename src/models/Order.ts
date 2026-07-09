import mongoose, { Document, Schema } from 'mongoose';
import { multiTenancyPlugin } from '../utils/multiTenancyPlugin.ts';

export interface IOrder extends Document {
  userId?: mongoose.Types.ObjectId;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  customerEmail?: string;
  totalAmount: number;
  voucherId?: mongoose.Types.ObjectId;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  paymentMethod: 'cod' | 'bank_transfer' | 'credit_card' | 'momo' | 'zalopay' | 'vnpay';
  paymentStatus: 'unpaid' | 'paid' | 'refunded';
  paymentInfo?: {
    txnRef?: string;
    transactionNo?: string;
    payDate?: string;
    bankCode?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const OrderSchema = new Schema<IOrder>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    customerName: { type: String, required: true },
    customerPhone: { type: String },
    customerAddress: { type: String },
    totalAmount: { type: Number, required: true },
    voucherId: { type: Schema.Types.ObjectId, ref: 'Voucher' },
    status: {
      type: String,
      enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
      default: 'pending',
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: ['cod', 'bank_transfer', 'credit_card', 'momo', 'zalopay', 'vnpay'],
      default: 'cod',
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'refunded'],
      default: 'unpaid',
      index: true,
    },
    paymentInfo: {
      type: {
        txnRef: { type: String },
        transactionNo: { type: String },
        payDate: { type: String },
        bankCode: { type: String },
      },
      default: undefined,
    },
  },
  {
    timestamps: true,
    collection: 'orders',
  }
);

OrderSchema.plugin(multiTenancyPlugin);

export const Order =
  mongoose.models.Order || mongoose.model<IOrder>('Order', OrderSchema);
