import mongoose, { Document, Schema } from 'mongoose';

export interface IArticle extends Document {
  title: string;
  slug: string;
  summary: string;
  content: string;
  thumbnail: string;
  category: 'KIENTHUC' | 'XUHUONG' | 'SANPHAM' | 'SUKIEN';
  tags: string[];
  author: {
    name: string;
    avatar?: string;
  };
  views: number;
  isPublished: boolean;
  featured: boolean;
  readingTimeMinutes: number;
  publishedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ArticleSchema = new Schema<IArticle>(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    summary: { type: String, required: true },
    content: { type: String, required: true },
    thumbnail: { type: String, required: true },
    category: {
      type: String,
      enum: ['KIENTHUC', 'XUHUONG', 'SANPHAM', 'SUKIEN'],
      default: 'KIENTHUC',
      index: true,
    },
    tags: [{ type: String, trim: true }],
    author: {
      name: { type: String, default: "L'essence Editorial" },
      avatar: { type: String },
    },
    views: { type: Number, default: 0, min: 0 },
    isPublished: { type: Boolean, default: true, index: true },
    featured: { type: Boolean, default: false, index: true },
    readingTimeMinutes: { type: Number, default: 3 },
    publishedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

ArticleSchema.index({ title: 'text', summary: 'text', content: 'text' });

export const Article = mongoose.model<IArticle>('Article', ArticleSchema);
