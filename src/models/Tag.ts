import mongoose, { Document, Schema } from 'mongoose';
import { multiTenancyPlugin } from '../utils/multiTenancyPlugin.ts';

export interface ITag extends Document {
  name: string;
  slug: string;
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
}

const TagSchema = new Schema<ITag>(
  {
    name: { type: String, required: true, index: true },
    slug: { type: String, required: true, index: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }
  },
  {
    timestamps: true,
    collection: 'tags'
  }
);

TagSchema.plugin(multiTenancyPlugin);

export const Tag = mongoose.models.Tag || mongoose.model<ITag>('Tag', TagSchema);
