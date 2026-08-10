import mongoose, { Schema, Document } from 'mongoose';

export interface ICart extends Document {
  userId: mongoose.Types.ObjectId;
  totalAmount: number;
  voucherCode?: string;
  voucherDiscount?: number;
  freeshipVoucherCode?: string;
  updatedAt: Date;
  createdAt: Date;
}

const CartSchema = new Schema<ICart>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    totalAmount: { type: Number, default: 0 },
    voucherCode: { type: String, default: null },
    voucherDiscount: { type: Number, default: 0 },
    freeshipVoucherCode: { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model<ICart>('Cart', CartSchema);