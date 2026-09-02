import mongoose, { Document, Schema } from 'mongoose';

export interface INewsAutoPilotLog {
  triggeredAt: Date;
  status: 'success' | 'failed';
  articleId?: mongoose.Types.ObjectId;
  articleTitle?: string;
  articleSlug?: string;
  category?: string;
  triggerType: 'cron' | 'manual';
  error?: string;
}

export interface INewsAutoPilotConfig extends Document {
  isActive: boolean;
  topics: string[];
  categories: Array<'KIENTHUC' | 'XUHUONG' | 'SANPHAM' | 'SUKIEN'>;
  scheduleType: 'daily' | 'weekly' | 'interval';
  scheduleTime: string; // "08:00"
  scheduleDays: number[]; // [1, 3, 5] (1 = Mon, 7 = Sun)
  intervalHours: number; // 24
  publishMode: 'publish' | 'draft';
  autoFeatured: boolean;
  tone: 'luxury' | 'informative' | 'storytelling' | 'friendly';
  authorName: string;
  lastRunAt?: Date;
  nextRunAt?: Date;
  totalGenerated: number;
  logs: INewsAutoPilotLog[];
  createdAt: Date;
  updatedAt: Date;
}

const NewsAutoPilotLogSchema = new Schema<INewsAutoPilotLog>(
  {
    triggeredAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['success', 'failed'], required: true },
    articleId: { type: Schema.Types.ObjectId, ref: 'Article' },
    articleTitle: { type: String },
    articleSlug: { type: String },
    category: { type: String },
    triggerType: { type: String, enum: ['cron', 'manual'], default: 'cron' },
    error: { type: String },
  },
  { _id: false }
);

const NewsAutoPilotConfigSchema = new Schema<INewsAutoPilotConfig>(
  {
    isActive: { type: Boolean, default: false },
    topics: {
      type: [String],
      default: [
        'Nghệ thuật chọn nước hoa theo mùa và phong cách sống',
        'Khám phá thế giới nước hoa Niche và những nốt hương độc bản',
        'Bí quyết xịt và bảo quản nước hoa giữ mùi lâu hơn 12 giờ',
        'Top những nốt hương hoa cỏ và gỗ quý được yêu thích nhất',
        'Xu hướng mùi hương nước hoa Unisex hiện đại',
      ],
    },
    categories: {
      type: [String],
      enum: ['KIENTHUC', 'XUHUONG', 'SANPHAM', 'SUKIEN'],
      default: ['KIENTHUC', 'XUHUONG', 'SANPHAM'],
    },
    scheduleType: {
      type: String,
      enum: ['daily', 'weekly', 'interval'],
      default: 'daily',
    },
    scheduleTime: { type: String, default: '08:00' },
    scheduleDays: { type: [Number], default: [1, 3, 5] },
    intervalHours: { type: Number, default: 24, min: 1 },
    publishMode: {
      type: String,
      enum: ['publish', 'draft'],
      default: 'publish',
    },
    autoFeatured: { type: Boolean, default: false },
    tone: {
      type: String,
      enum: ['luxury', 'informative', 'storytelling', 'friendly'],
      default: 'luxury',
    },
    authorName: { type: String, default: "L'essence AI Editorial" },
    lastRunAt: { type: Date },
    nextRunAt: { type: Date },
    totalGenerated: { type: Number, default: 0 },
    logs: { type: [NewsAutoPilotLogSchema], default: [] },
  },
  { timestamps: true }
);

export const NewsAutoPilotConfig = mongoose.model<INewsAutoPilotConfig>(
  'NewsAutoPilotConfig',
  NewsAutoPilotConfigSchema
);
