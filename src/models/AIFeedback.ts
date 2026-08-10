import mongoose, { Schema, Document } from 'mongoose';

export interface IAIFeedback extends Document {
  messageId: string;
  question: string;
  answer: string;
  rating: number;
  embedding: number[];
  userId?: mongoose.Types.ObjectId;
  createdAt: Date;
}

const AIFeedbackSchema: Schema = new Schema({
  messageId: { type: String, required: true, unique: true },
  question: { type: String, required: true },
  answer: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  embedding: { type: [Number], default: undefined },
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  createdAt: { type: Date, default: Date.now },
});

// Index cho vector search (MongoDB Atlas)
AIFeedbackSchema.index({ embedding: 1 }, { name: 'feedback_vector_index' });
export const AIFeedback = mongoose.model<IAIFeedback>('AIFeedback', AIFeedbackSchema);