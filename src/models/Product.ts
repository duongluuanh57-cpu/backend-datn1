import mongoose, { Document, Schema } from 'mongoose';
import { Brand } from './Brand.ts';
import { Category } from './Category.ts';

export interface IProduct extends Document {
  name: string;
  slug?: string;
  brandId: mongoose.Types.ObjectId;
  variants?: mongoose.Types.ObjectId[];

  description: string;
  image?: string;
  categories?: mongoose.Types.ObjectId[];
  reviewsCount?: number;
  avgRating?: number;
  discountPercentage?: number;
  soldCount?: number;
  viewCount?: number;
  specifications?: {
    longevity?: string;
    sillage?: string;
    scentTrail?: string;
    style?: string;
    suitableFor?: string;
    occasion?: string;
    season?: string;
    time?: string;
  };

  isFeatured?: boolean;
  isNewArrival?: boolean;
  isBestSeller?: boolean;

  // ── AI Metadata (Vector Embedding + Supplement Workflow) ──
  aiData?: {
    embedding?: number[];
    isSupplemented?: boolean;
  };

  status: string; // 'draft' | 'active' | 'archived'

  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true, index: true },
    slug: { type: String, unique: true, sparse: true, trim: true, lowercase: true, index: true },
    brandId: { type: Schema.Types.ObjectId, ref: 'Brand', required: true, index: true },
    variants: { type: [{ type: Schema.Types.ObjectId, ref: 'ProductVariant' }], default: [] },

    description: { type: String, default: '', trim: true },
    image: { type: String, default: '', trim: true },
    categories: { type: [{ type: Schema.Types.ObjectId, ref: 'Category' }], default: [] },
    reviewsCount: { type: Number, default: 0, min: 0 },
    avgRating: { type: Number, default: 0, min: 0, max: 5 },
    discountPercentage: { type: Number, default: 0, min: 0, max: 100 },
    soldCount: { type: Number, default: 0, min: 0 },
    viewCount: { type: Number, default: 0, min: 0 },
    isFeatured: { type: Boolean, default: false, index: true },
    isNewArrival: { type: Boolean, default: false, index: true },
    isBestSeller: { type: Boolean, default: false, index: true },

    specifications: {
      type: {
        longevity: { type: String, default: '', trim: true },
        sillage: { type: String, default: '', trim: true },
        scentTrail: { type: String, default: '', trim: true },
        style: { type: String, default: '', trim: true },
        suitableFor: { type: String, default: '', trim: true },
        occasion: { type: String, default: '', trim: true },
        season: { type: String, default: '', trim: true },
        time: { type: String, default: '', trim: true },
      },
      default: {},
    },

    // ── AI Metadata Sub-document ──
    aiData: {
      type: {
        embedding: { type: [Number], default: undefined },
        isSupplemented: { type: Boolean, default: false },
      },
      default: {},
    },

    status: { type: String, default: 'draft', enum: ['draft', 'active', 'archived'], index: true },
  },
  {
    timestamps: true,
    collection: 'products'
  }
);

/**
 * TỰ ĐỘNG NẠP KIẾN THỨC (Auto-Ingestion)
 * Mỗi khi lưu sản phẩm, tự động tạo Vector Embedding để AI thấu hiểu sản phẩm
 */
ProductSchema.post('save', async function() {
  try {
    console.log(`🧠 [AI Auto-Train] Đang nạp kiến thức cho sản phẩm: ${this.name}`);
    void Brand;
    void Category;

    const populated = await this.populate([
      { path: 'brandId', select: 'name' },
      { path: 'categories', select: 'name' },
    ]) as any;
    const brandName = populated.brandId?.name || '';
    const categoryNames = (populated.categories as any[] || [])
      .map((c: any) => c?.name)
      .filter(Boolean)
      .join(' ');

    const textToEmbed = `${this.name} ${brandName} ${this.description} ${categoryNames}`;

    const { AIService } = await import('../services/AIService.ts');
    const vector = await AIService.generateEmbedding(textToEmbed);

    await Product.updateOne(
      { _id: this._id },
      { $set: { 'aiData.embedding': vector } }
    );
  } catch (err) {
    console.error('⚠️ [AI Auto-Train Error] Không thể tạo embedding:', err);
  }
});

ProductSchema.index({ name: 'text', description: 'text' });
ProductSchema.index({ status: 1, createdAt: -1 });
ProductSchema.index({ status: 1, soldCount: -1 });
ProductSchema.index({ categories: 1 });
ProductSchema.index({ brandId: 1, status: 1 });

export const Product = mongoose.models.Product || mongoose.model<IProduct>('Product', ProductSchema);