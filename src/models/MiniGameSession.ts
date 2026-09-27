import mongoose, { Document, Schema } from 'mongoose';
export type GameType = 'wheel';
export type GameStatus = 'won' | 'lost';

export interface IMiniGameSession extends Document {
  userId?: mongoose.Types.ObjectId | string;
  gameType: GameType;
  status: GameStatus;
  reward?: {
    points: number;
    label?: string;
    balanceAfter?: number;
  };
  playedAt: Date;
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
      points: { type: Number, required: true, min: 0 },
      label: { type: String },
      balanceAfter: { type: Number, min: 0 },
    },
    playedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: 'mini_game_sessions',
  }
);

export const MiniGameSession =
  mongoose.models.MiniGameSession ||
  mongoose.model<IMiniGameSession>('MiniGameSession', MiniGameSessionSchema);
