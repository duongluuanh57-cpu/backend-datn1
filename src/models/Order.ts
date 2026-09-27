import mongoose, { Document, Schema } from 'mongoose';

/**
 * Order — bảng `orders` theo ERD.
 *
 * Bảng `payments` đã bị xoá: thông tin thanh toán (payment_method_id, bank_code,
 * mã giao dịch, thời điểm trả tiền) được dồn về chính bảng này.
 *
 *   order_id (_id), user_id, voucher_id, payment_method_id, receive_name,
 *   address, phone, total_amount, status, created_at, shipping_fee,
 *   tracking_number, bank_code, note, payment_status,
 *   + payment_txn_ref, payment_transaction_code, paid_at
 *
 * Tên cột snake_case ở trên tương ứng với field camelCase trong schema
 * (paymentTxnRef, paymentTransactionCode, paidAt) — cùng quy ước với toàn bộ
 * schema này (receive_name → receiveName, payment_status → paymentStatus...).
 *
 * Địa chỉ là SNAPSHOT tại thời điểm đặt hàng (không FK tới user_addresses),
 * nên sửa/xoá địa chỉ sau đó không làm đổi đơn cũ.
 *
 * Các giá trị dẫn xuất KHÔNG lưu trong bảng — tính khi đọc từ order_items và
 * voucher đã dùng: itemsSubtotal, voucherCode, voucherDiscount.
 */
export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
export type OrderPaymentStatus = 'unpaid' | 'paid' | 'refunded';

export interface IOrder extends Document {
  userId: mongoose.Types.ObjectId;
  voucherId?: mongoose.Types.ObjectId;
  paymentMethodId: mongoose.Types.ObjectId;

  receiveName: string;
  phone: string;
  address: string;
  note: string;

  /**
   * Customer shipping info snapshot at order time (deprecated - use flat fields above)
   */
  shippingInfo?: {
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    customerAddress: string;
  };

  totalAmount: number;
  shippingFee: number;
  rewardPointsUsed?: number;
  rewardPointsDiscount?: number;
  rewardPointsRefunded?: boolean;
  trackingNumber?: string;

  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;

  /**
   * Bank code dùng để match đối soát từ VNPay (nếu có).
   */
  bankCode?: string;

  /**
   * Thông tin giao dịch (bảng `payments` đã gộp về đây). Phải KHAI BÁO trong schema —
   * Mongoose strict mode âm thầm vứt mọi $set vào đường không khai báo, nên trước đây
   * paidAt/paymentTxnRef ghi xuống là mất hút và `findOne({ paymentTxnRef })` không bao giờ
   * khớp. Tên field theo camelCase thống nhất với cả bảng (paymentStatus, totalAmount...).
   */
  paymentTxnRef?: string;
  paymentTransactionCode?: string;
  paidAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const OrderSchema = new Schema<IOrder>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    voucherId: { type: Schema.Types.ObjectId, ref: 'Voucher' },
    paymentMethodId: { type: Schema.Types.ObjectId, ref: 'PaymentMethod', required: true, index: true },

    receiveName: { type: String, required: true, trim: true },
    phone: { type: String, default: '', trim: true },
    address: { type: String, default: '', trim: true },
    note: { type: String, default: '', trim: true },

    shippingInfo: {
      customerName: { type: String },
      customerEmail: { type: String },
      customerPhone: { type: String },
      customerAddress: { type: String },
    },

    totalAmount: { type: Number, required: true },
    shippingFee: { type: Number, default: 0 },
    rewardPointsUsed: { type: Number, default: 0, min: 0 },
    rewardPointsDiscount: { type: Number, default: 0, min: 0 },
    rewardPointsRefunded: { type: Boolean, default: false },
    trackingNumber: { type: String, default: '', trim: true },

    status: {
      type: String,
      enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
      default: 'pending',
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'refunded'],
      default: 'unpaid',
      index: true,
    },

    bankCode: { type: String },

    paymentTxnRef: { type: String, default: '', index: true },
    paymentTransactionCode: { type: String, default: '' },
    paidAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'orders',
  }
);

OrderSchema.index({ createdAt: -1, status: 1 });
OrderSchema.index({ paymentMethodId: 1, paymentStatus: 1, status: 1 });

export const Order =
  mongoose.models.Order || mongoose.model<IOrder>('Order', OrderSchema);
