import mongoose, { Document, Schema } from 'mongoose';

export interface IDailySummaryReport extends Document {
  date: Date;
  totalRevenue: number;
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  cancelledRevenue: number;
  updatedAt: Date;
}

const DailySummaryReportSchema = new Schema<IDailySummaryReport>(
  {
    date: { type: Date, required: true },
    totalRevenue: { type: Number, default: 0 },
    totalOrders: { type: Number, default: 0 },
    completedOrders: { type: Number, default: 0 },
    cancelledOrders: { type: Number, default: 0 },
    cancelledRevenue: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'daily_summary_reports',
  }
);

DailySummaryReportSchema.index({ date: 1 }, { unique: true });
DailySummaryReportSchema.index({ date: -1 });

export const DailySummaryReport =
  mongoose.models.DailySummaryReport ||
  mongoose.model<IDailySummaryReport>('DailySummaryReport', DailySummaryReportSchema);
