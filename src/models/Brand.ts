import mongoose, { Document, Schema } from 'mongoose';
export interface IBrand extends Document {
  name: string;
  slug?: string;
  logo?: string;
  origin?: string;
  status: 'active' | 'inactive';
  featured: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BrandSchema = new Schema<IBrand>(
  {
    name: { type: String, required: true, index: true },
    slug: { type: String, index: true, sparse: true },
    logo: { type: String },
    origin: { type: String },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    featured: { type: Boolean, default: false }
  },
  {
    timestamps: true,
    collection: 'brands'
  }
);

BrandSchema.index({ name: 'text' });
BrandSchema.index({ slug: 1 });

export const Brand = mongoose.models.Brand || mongoose.model<IBrand>('Brand', BrandSchema);
