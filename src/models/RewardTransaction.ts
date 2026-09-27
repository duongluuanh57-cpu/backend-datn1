import mongoose, { Document, Schema } from 'mongoose';

export type RewardTransactionType = 'earn' | 'spend' | 'refund' | 'membership_bonus';
export type RewardUnit = 'points' | 'spins';
export type RewardSource = 'minigame' | 'membership' | 'order' | 'admin';

export interface IRewardTransaction extends Document {
  userId: mongoose.Types.ObjectId;
  type: RewardTransactionType;
  unit: RewardUnit;
  amount: number;
  balanceAfter: number;
  source: RewardSource;
  orderId?: mongoose.Types.ObjectId;
  sessionId?: mongoose.Types.ObjectId;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const RewardTransactionSchema = new Schema<IRewardTransaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['earn', 'spend', 'refund', 'membership_bonus'], required: true, index: true },
    unit: { type: String, enum: ['points', 'spins'], required: true },
    amount: { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true, min: 0 },
    source: { type: String, enum: ['minigame', 'membership', 'order', 'admin'], required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', index: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'MiniGameSession', index: true },
    description: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'reward_transactions',
  },
);

RewardTransactionSchema.index({ userId: 1, createdAt: -1 });
RewardTransactionSchema.index({ orderId: 1, type: 1 });
RewardTransactionSchema.index({ sessionId: 1, type: 1 });

export const RewardTransaction =
  mongoose.models.RewardTransaction ||
  mongoose.model<IRewardTransaction>('RewardTransaction', RewardTransactionSchema);
