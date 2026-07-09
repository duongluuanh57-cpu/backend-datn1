import { MiniGameSession, type GameType } from '../models/MiniGameSession.ts';
import { Voucher } from '../models/Voucher.ts';

const DAILY_LIMIT = 3;
const COOLDOWN_SECONDS = 60;

export class MiniGameService {
  /**
   * Generate a unique voucher code for mini game rewards
   */
  static generateVoucherCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'MG';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Check if user can play (daily limit + cooldown)
   */
  static async canPlay(userId?: string) {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Count today's plays
    const todayPlays = await MiniGameSession.countDocuments({
      userId: userId || 'guest',
      playedAt: { $gte: startOfDay },
    });

    if (todayPlays >= DAILY_LIMIT) {
      return { allowed: false, reason: 'Bạn đã hết lượt chơi hôm nay. Quay lại vào ngày mai!' };
    }

    // Check cooldown
    if (userId) {
      const lastPlay = await MiniGameSession.findOne({
        userId,
      }).sort({ playedAt: -1 });

      if (lastPlay) {
        const elapsed = (now.getTime() - lastPlay.playedAt.getTime()) / 1000;
        if (elapsed < COOLDOWN_SECONDS) {
          return {
            allowed: false,
            reason: `Vui lòng chờ ${Math.ceil(COOLDOWN_SECONDS - elapsed)} giây trước khi chơi tiếp`,
            cooldownRemaining: Math.ceil(COOLDOWN_SECONDS - elapsed),
          };
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Get today's remaining plays for a user
   */
  static async getRemainingPlays(userId?: string) {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const todayPlays = await MiniGameSession.countDocuments({
      userId: userId || 'guest',
      playedAt: { $gte: startOfDay },
    });

    return Math.max(0, DAILY_LIMIT - todayPlays);
  }

  /**
   * Save a game result and create voucher if won
   */
  static async saveResult(
    data: {
      gameType: GameType;
      won: boolean;
      discountType?: 'percentage' | 'fixed';
      discountAmount?: number;
    },
    userId?: string
  ) {
    const voucherCode = data.won ? this.generateVoucherCode() : undefined;

    // Create game session record
    const session = await MiniGameSession.create({
      userId: userId || 'guest',
      gameType: data.gameType,
      status: data.won ? 'won' : 'lost',
      playedAt: new Date(),
      reward: data.won
        ? {
            voucherCode,
            discountType: data.discountType,
            discountAmount: data.discountAmount,
          }
        : undefined,
    });

    // If won, also create a voucher in the DB
    if (data.won && voucherCode && data.discountType && data.discountAmount) {
      const now = new Date();
      const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

      await Voucher.create({
        code: voucherCode,
        type: data.discountType,
        value: data.discountAmount,
        minOrderAmount: 0,
        maxDiscount: data.discountType === 'percentage' ? 200000 : undefined,
        maxUsage: 1,
        usedCount: 0,
        startDate: now,
        endDate,
        status: 'active',
      });
    }

    return session;
  }

  /**
   * Get game history for a user
   */
  static async getHistory(userId?: string, limit = 20) {
    return MiniGameSession.find({
      userId: userId || 'guest',
    })
      .sort({ playedAt: -1 })
      .limit(limit)
      .lean();
  }

  /**
   * Get daily limit config
   */
  static getDailyLimit() {
    return DAILY_LIMIT;
  }

  static getCooldownSeconds() {
    return COOLDOWN_SECONDS;
  }
}
