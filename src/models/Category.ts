import mongoose, { Document, Schema } from 'mongoose';
export interface ICategory extends Document {
  name: string;
  slug: string;
  status: 'active' | 'inactive';
}

const CategorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  {
    timestamps: false,
    collection: 'categories'
  }
);

CategorySchema.index({ slug: 1 }, { unique: true });

export const Category = mongoose.models.Category || mongoose.model<ICategory>('Category', CategorySchema);
