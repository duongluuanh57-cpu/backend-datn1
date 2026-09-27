import mongoose, { Document, Schema } from 'mongoose';

export type PaymentMethodCode = 'cod' | 'vnpay';

/**
 * payment_methods — danh mục phương thức thanh toán.
 * `code` giữ lại làm khoá nghiệp vụ (logic tra 'cod'/'vnpay'), `icon` phục vụ
 * hiển thị; `status` thay cho isActive trước đây.
 */
export interface IPaymentMethod extends Document {
  name: string;
  description?: string;
  code: PaymentMethodCode;
  icon?: string;
  status: 'active' | 'inactive';
}

const PaymentMethodSchema = new Schema<IPaymentMethod>(
  {
    name: { type: String, required: true },
    description: { type: String, default: '' },
    code: { type: String, required: true, enum: ['cod', 'vnpay'], unique: true, index: true },
    icon: { type: String, default: '' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
  },
  {
    timestamps: false,
    collection: 'payment_methods',
  }
);

export const PaymentMethod =
  mongoose.models.PaymentMethod ||
  mongoose.model<IPaymentMethod>('PaymentMethod', PaymentMethodSchema);