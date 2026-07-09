import mongoose, { Document, Schema } from 'mongoose';
import { multiTenancyPlugin } from '../utils/multiTenancyPlugin.ts';

export interface IContent extends Document {
  title: string;
  body: string;
  embedding: number[]; // Chứa vector embedding (từ Gemini/Ollama)
  sourceFile?: string;   // Đường dẫn file gốc
  chunkIndex?: number;   // Thứ tự của chunk trong file
  metadata?: any;        // Metadata bổ sung (hash, language, etc.)
  createdAt: Date;
}

const ContentSchema = new Schema<IContent>({
  title: { type: String, required: true },
  body: { type: String, required: true },
  embedding: { type: [Number], required: true }, // Mongoose lưu mảng số thực cho vector
  sourceFile: { type: String },
  chunkIndex: { type: Number },
  metadata: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now }
});

// Thêm text index cho Keyword Search
ContentSchema.index({ title: 'text', body: 'text' });

// Áp dụng Multi-tenancy
ContentSchema.plugin(multiTenancyPlugin);

export const Content = mongoose.model<IContent>('Content', ContentSchema);
