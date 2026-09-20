import mongoose, { Document, Schema } from 'mongoose';
export type GameType = 'wheel';
export type GameStatus = 'won' | 'lost';

export interface IMiniGameSession extends Document {
  userId?: mongoose.Types.ObjectId | string;
  gameType: GameType;
  status: GameStatus;
  reward?: {
    voucherCode: string;
    discountType: 'percentage' | 'fixed';
    discountAmount: number;
    label?: string;
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
      enum: ['wheel'],
    },
    status: {
      type: String,
      enum: ['won', 'lost'],
      required: true,
    },
    reward: {
      voucherCode: { type: String },
      discountType: { type: String, enum: ['percentage', 'fixed'] },
      discountAmount: { type: Number },
      label: { type: String },
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
