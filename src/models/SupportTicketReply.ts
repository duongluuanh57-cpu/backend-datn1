import mongoose, { Document, Schema } from 'mongoose';

export interface ISupportTicketReply extends Document {
  ticketId: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId;
  message: string;
  image?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SupportTicketReplySchema = new Schema<ISupportTicketReply>(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: 'SupportTicket', required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    message: { type: String, required: true, trim: true },
    image: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'support_tickets_reply',
  }
);

SupportTicketReplySchema.index({ ticketId: 1, createdAt: 1 });

export const SupportTicketReply = mongoose.models.SupportTicketReply || mongoose.model<ISupportTicketReply>('SupportTicketReply', SupportTicketReplySchema);
