import mongoose, { Document, Schema } from 'mongoose';
import { Brand } from './Brand.ts';
import { Category } from './Category.ts';

export interface IProduct extends Document {
  name: string;
  slug?: string;
  brandId: mongoose.Types.ObjectId;

  description: string;
  image?: string;
  // 1 sản phẩm thuộc ĐÚNG 1 danh mục (theo ERD: category_id). Populate từ Category.
  categoryId: mongoose.Types.ObjectId;
  // reviewsCount / avgRating KHÔNG lưu ở đây — tính trực tiếp từ collection Review
  // lúc đọc (productFormatterService / ReviewService.getStats), tránh cache tự tham chiếu.
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

  // ── Vòng đời discount tự động: true = discountPercentage hiện tại do hệ thống
  // tự gán cho hàng Tag New (5%), để lúc hết New không xóa nhầm giảm giá admin đặt tay
  autoDiscount?: boolean;

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
    // Variants truy vấn qua ProductVariant.productId (1 product : 0..N variant) —
    // không lưu mảng ObjectId ở đây để tránh hai nguồn sự thật.

    description: { type: String, default: '', trim: true },
    image: { type: String, default: '', trim: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    discountPercentage: { type: Number, default: 0, min: 0, max: 100 },
    soldCount: { type: Number, default: 0, min: 0 },
    viewCount: { type: Number, default: 0, min: 0 },
    isFeatured: { type: Boolean, default: false, index: true },
    isNewArrival: { type: Boolean, default: false, index: true },
    isBestSeller: { type: Boolean, default: false, index: true },
    autoDiscount: { type: Boolean, default: false, index: true },

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
ProductSchema.post('save', function(doc) {
  // Thực thi bất đồng bộ ở background, không block luồng lưu DB và response HTTP
  setImmediate(async () => {
    try {
      if (!doc || !doc._id) return;
      void Brand;
      void Category;

      const populated = await Product.findById(doc._id)
        .select('name description brandId categoryId')
        .populate([
          { path: 'brandId', select: 'name' },
          { path: 'categoryId', select: 'name' },
        ])
        .lean() as any;
      if (!populated) return;

      const brandName = populated.brandId?.name || '';
      const categoryName = (populated.categoryId as any)?.name || '';

      const textToEmbed = `${populated.name} ${brandName} ${populated.description || ''} ${categoryName}`;

      const { AIService } = await import('../services/AIService.ts');
      const vector = await AIService.generateEmbedding(textToEmbed);

      if (vector && vector.length > 0) {
        await Product.updateOne(
          { _id: doc._id },
          { $set: { 'aiData.embedding': vector } }
        );
      }
    } catch (err) {
      console.error('⚠️ [AI Auto-Train Error] Không thể tạo embedding:', err);
    }
  });
});

ProductSchema.index({ name: 'text', description: 'text' });
ProductSchema.index({ status: 1, createdAt: -1 });
ProductSchema.index({ status: 1, soldCount: -1 });
ProductSchema.index({ status: 1, soldCount: -1, createdAt: -1 });
ProductSchema.index({ status: 1, discountPercentage: -1 });
ProductSchema.index({ status: 1, isFeatured: 1, createdAt: -1 });
ProductSchema.index({ categoryId: 1, status: 1 });
ProductSchema.index({ brandId: 1, status: 1 });

export const Product = mongoose.models.Product || mongoose.model<IProduct>('Product', ProductSchema);