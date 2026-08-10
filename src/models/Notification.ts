import mongoose, { Document, Schema } from 'mongoose';

export type NotificationType = 'order' | 'promotion' | 'system' | 'minigame';

export interface INotification extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  message: string;
  type: NotificationType;
  isRead: boolean;
  link?: string;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['order', 'promotion', 'system', 'minigame'],
      default: 'system',
      index: true,
    },
    isRead: { type: Boolean, default: false, index: true },
    link: { type: String, default: '', trim: true },
  },
  {
    timestamps: true,
    collection: 'notifications',
  }
);

NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

export const Notification =
  mongoose.models.Notification ||
  mongoose.model<INotification>('Notification', NotificationSchema);
