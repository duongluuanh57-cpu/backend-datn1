import mongoose, { Document, Schema } from 'mongoose';
export type GameType = 'wheel' | 'scratch' | 'dice' | 'quiz';
export type GameStatus = 'playing' | 'won' | 'lost';

export interface IMiniGameSession extends Document {
  userId?: mongoose.Types.ObjectId | string;
  gameType: GameType;
  status: GameStatus;
  reward?: {
    voucherCode: string;
    discountType: 'percentage' | 'fixed';
    discountAmount: number;
  };
  playedAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MiniGameSessionSchema = new Schema<IMiniGameSession>(
  {
    userId: { type: Schema.Types.Mixed, index: true },
    gameType: {
      type: String,
      required: true,
      enum: ['wheel', 'scratch', 'dice', 'quiz'],
    },
    status: {
      type: String,
      enum: ['playing', 'won', 'lost'],
      default: 'playing',
    },
    reward: {
      voucherCode: { type: String },
      discountType: { type: String, enum: ['percentage', 'fixed'] },
      discountAmount: { type: Number },
    },
    playedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'mini_game_sessions',
  }
);

export const MiniGameSession =
  mongoose.models.MiniGameSession ||
  mongoose.model<IMiniGameSession>('MiniGameSession', MiniGameSessionSchema);
