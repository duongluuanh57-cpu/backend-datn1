import mongoose, { Document, Schema } from 'mongoose';
import { multiTenancyPlugin } from '../utils/multiTenancyPlugin.ts';

export interface IAuditLog extends Document {
  userId: mongoose.Types.ObjectId;
  action: string;      // Ví dụ: 'LOGIN', 'PASSWORD_CHANGE', 'DELETE_USER'
  resource: string;    // Ví dụ: 'User', 'Content'
  metadata: any;       // Thông tin chi tiết (IP, Browser, ID của bản ghi bị tác động)
  status: 'SUCCESS' | 'FAILURE';
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true, index: true },
  resource: { type: String, required: true },
  metadata: { type: Schema.Types.Mixed },
  status: { type: String, enum: ['SUCCESS', 'FAILURE'], default: 'SUCCESS' },
  createdAt: { type: Date, default: Date.now, index: true }
});

AuditLogSchema.plugin(multiTenancyPlugin);

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
