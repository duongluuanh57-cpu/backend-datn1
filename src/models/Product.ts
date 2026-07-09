import mongoose, { Document, Schema } from 'mongoose';
import { multiTenancyPlugin } from '../utils/multiTenancyPlugin.ts';
import { Brand } from './Brand.ts';
import { Category } from './Category.ts';

export interface IProduct extends Document {
  name: string;
  brandId: mongoose.Types.ObjectId;
  variants?: mongoose.Types.ObjectId[];

  description: string;
  image?: string;
  categories?: mongoose.Types.ObjectId[];
  reviewsCount?: number;
  discountPercentage?: number;
  discountStartDate?: Date | null;
  discountEndDate?: Date | null;
  soldCount?: number;
  viewCount?: number;
  longevity?: string;
  sillage?: string;
  durability?: string;
  scentTrail?: string;
  style?: string;
  suitableFor?: string;
  occasion?: string;
  season?: string;
  time?: string;

  // ── AI embedding (migrated from ProductSEO) ──
  embedding?: number[];

  // ── Supplement workflow ──
  isSupplemented: boolean;
  status: string; // 'draft' | 'active' | 'archived'

  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, index: true },
    brandId: { type: Schema.Types.ObjectId, ref: 'Brand', required: true, index: true },
    variants: [{ type: Schema.Types.ObjectId, ref: 'ProductVariant' }],

    description: { type: String },
    image: { type: String },
    categories: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
    reviewsCount: { type: Number, default: 0 },
    discountPercentage: { type: Number, default: 0 },
    discountStartDate: { type: Date, default: null },
    discountEndDate: { type: Date, default: null },
    soldCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
    longevity: { type: String, default: '' },
    sillage: { type: String, default: '' },
    durability: { type: String, default: '' },
    scentTrail: { type: String, default: '' },
    style: { type: String, default: '' },
    suitableFor: { type: String, default: '' },
    occasion: { type: String, default: '' },
    season: { type: String, default: '' },
    time: { type: String, default: '' },

    // ── AI embedding (migrated from ProductSEO) ──
    embedding: { type: [Number], default: undefined },

    // ── Supplement workflow ──
    isSupplemented: { type: Boolean, default: false, index: true },
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
      { $set: { embedding: vector } }
    );
  } catch (err) {
    console.error('⚠️ [AI Auto-Train Error] Không thể tạo embedding:', err);
  }
});

ProductSchema.index({ name: 'text', description: 'text' });

ProductSchema.plugin(multiTenancyPlugin);

export const Product = mongoose.models.Product || mongoose.model<IProduct>('Product', ProductSchema);