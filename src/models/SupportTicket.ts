import mongoose, { Document, Schema } from 'mongoose';

export type TicketType = 
  | 'order_inquiry'    // Tra cứu đơn hàng
  | 'shipping_delay'   // Giao hàng chậm / Sự cố vận chuyển
  | 'return_refund'    // Yêu cầu đổi trả / Hoàn tiền
  | 'payment_issue'    // Vấn đề thanh toán
  | 'product_issue'    // Sản phẩm bị lỗi / Hư hỏng
  | 'other';           // Vấn đề khác

export type Department = 
  | 'cskh'             // Chăm sóc khách hàng
  | 'shipping'         // Bộ phận Vận chuyển
  | 'accounting'       // Bộ phận Kế toán / Thanh toán
  | 'technical'        // Bộ phận Kỹ thuật / Đổi trả
  | 'general';         // Bộ phận Hỗ trợ chung

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface ISupportTicket extends Document {
  userId: mongoose.Types.ObjectId;
  orderId?: mongoose.Types.ObjectId;
  returnId?: mongoose.Types.ObjectId;
  ticketType: TicketType | string;
  department: Department | string;
  title: string;
  status: TicketStatus;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SupportTicketSchema = new Schema<ISupportTicket>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', index: true },
    returnId: { type: Schema.Types.ObjectId, ref: 'ReturnItem', index: true },
    ticketType: { 
      type: String, 
      default: 'order_inquiry', 
      index: true 
    },
    department: { 
      type: String, 
      default: 'cskh', 
      index: true 
    },
    title: { type: String, required: true, trim: true },
    status: { 
      type: String, 
      enum: ['open', 'in_progress', 'resolved', 'closed'], 
      default: 'open', 
      index: true 
    },
    closedAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'support_tickets',
  }
);

SupportTicketSchema.index({ userId: 1, createdAt: -1 });
SupportTicketSchema.index({ orderId: 1, createdAt: -1 });

export const SupportTicket = mongoose.models.SupportTicket || mongoose.model<ISupportTicket>('SupportTicket', SupportTicketSchema);
