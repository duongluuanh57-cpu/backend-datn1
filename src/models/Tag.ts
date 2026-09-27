import mongoose, { Document, Schema } from 'mongoose';
export interface ITag extends Document {
  name: string;
  slug: string;
  status: 'active' | 'inactive';
}

const TagSchema = new Schema<ITag>(
  {
    name: { type: String, required: true, index: true },
    slug: { type: String, required: true, index: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }
  },
  {
    timestamps: false,
    collection: 'tags'
  }
);

export const Tag = mongoose.models.Tag || mongoose.model<ITag>('Tag', TagSchema);
