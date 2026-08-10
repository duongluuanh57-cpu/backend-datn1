import { MiniGameSession, type GameType } from '../models/MiniGameSession.ts';
import { Voucher } from '../models/Voucher.ts';
import { UserVoucher } from '../models/UserVoucher.ts';
import { User } from '../models/User.ts';
import { VoucherService } from './VoucherService.ts';
import mongoose from 'mongoose';

const DAILY_LIMIT = 3; // Deprecated in favor of custom spin turns

export class MiniGameService {
  /**
   * Check if user can play based on spinTurns
   */
  static async canPlay(userId?: string) {
    if (!userId || userId === 'guest') {
      return { allowed: false, reason: 'Vui lòng đăng nhập để tham gia trò chơi này.' };
    }

    const user = await User.findById(userId).lean();
    if (!user) {
      return { allowed: false, reason: 'Không tìm thấy thông tin người dùng.' };
    }

    const turns = user.spinTurns || 0;
    if (turns <= 0) {
      return { allowed: false, reason: 'Bạn đã hết lượt quay. Hãy tích lũy thêm hoặc đợi ngày mai!' };
    }

    return { allowed: true, spinTurns: turns };
  }

  /**
   * Get today's remaining plays for a user (Mapped to spinTurns)
   */
  static async getRemainingPlays(userId?: string) {
    if (!userId || userId === 'guest') return 0;
    const user = await User.findById(userId).select('spinTurns').lean();
    return user?.spinTurns || 0;
  }

  /**
   * Đồng bộ và tính toán lượt quay mới của User dựa trên 3 điều kiện
   */
  static async syncUserSpinTurns(userId: string): Promise<number> {
    const user = await User.findById(userId);
    if (!user) return 0;

    let updated = false;
    const now = new Date();

    // 1. Lượt quay miễn phí mỗi ngày (1 lượt/ngày)
    const todayStr = now.toISOString().split('T')[0];
    const lastDailyStr = user.lastDailySpinGrantedAt
      ? new Date(user.lastDailySpinGrantedAt).toISOString().split('T')[0]
      : null;

    if (lastDailyStr !== todayStr) {
      user.spinTurns = (user.spinTurns || 0) + 1;
      user.lastDailySpinGrantedAt = now;
      updated = true;
      console.log(`🎰 [Spin Turn] Granted daily free turn to user ${userId}`);
    }

    // 2. Lượt quay từ chi tiêu đơn hàng đã giao (2M = 1 lượt)
    const ordersResult = await mongoose.model('Order').aggregate([
      { $match: { userId: user._id, status: 'delivered' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]);
    const totalSpent = ordersResult[0]?.total || 0;
    const expectedSpentTurns = Math.floor(totalSpent / 2000000);
    const currentSpentTurnsGranted = user.spentTurnsGranted || 0;

    if (expectedSpentTurns > currentSpentTurnsGranted) {
      const extraTurns = expectedSpentTurns - currentSpentTurnsGranted;
      user.spinTurns = (user.spinTurns || 0) + extraTurns;
      user.spentTurnsGranted = expectedSpentTurns;
      updated = true;
      console.log(`🎰 [Spin Turn] Granted ${extraTurns} turns for spending ${totalSpent.toLocaleString()}đ to user ${userId}`);
    }

    // 3. Lượt quay từ thăng hạng thành viên (1 lượt cho mỗi cấp hạng kể từ MEMBER)
    const TIER_LEVELS: Record<string, number> = { MEMBER: 0, Bac: 1, Vang: 2, KimCuong: 3 };
    const currentTierLevel = TIER_LEVELS[user.memberTier] || 0;
    const currentRankTurnsGranted = user.rankTurnsGranted || 0;

    if (currentTierLevel > currentRankTurnsGranted) {
      const extraTurns = currentTierLevel - currentRankTurnsGranted;
      user.spinTurns = (user.spinTurns || 0) + extraTurns;
      user.rankTurnsGranted = currentTierLevel;
      updated = true;
      console.log(`🎰 [Spin Turn] Granted ${extraTurns} turns for rank up to ${user.memberTier} to user ${userId}`);
    }

    if (updated) {
      await user.save();
    }

    return user.spinTurns || 0;
  }

  /**
   * Save a game result, deduct turn, and link random voucher if won
   */
  static async saveResult(
    data: {
      gameType: GameType;
      won: boolean;
      discountType?: 'percentage' | 'fixed';
      discountAmount?: number;
      segmentIndex?: number;
    },
    userId?: string
  ) {
    if (!userId || userId === 'guest') {
      throw new Error('Vui lòng đăng nhập để lưu kết quả game.');
    }

    // Trừ 1 lượt quay của user
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('Không tìm thấy thông tin người dùng.');
    }
    if ((user.spinTurns || 0) <= 0) {
      throw new Error('Bạn đã hết lượt quay.');
    }
    user.spinTurns = (user.spinTurns || 0) - 1;
    await user.save();

    let voucherCode = undefined;
    let selectedVoucher = null;
    let won = data.won;

    if (won) {
      await VoucherService.ensureDefaultMinigameVouchers();

      const minigameVouchers = await Voucher.find({
        applicableTo: 'minigame',
        status: 'active',
      }).sort({ createdAt: 1 }).lean();

      let minigameIndex = 0;
      if (data.segmentIndex === 0) minigameIndex = 0;
      else if (data.segmentIndex === 1) minigameIndex = 1;
      else if (data.segmentIndex === 2) minigameIndex = 2;
      else if (data.segmentIndex === 4) minigameIndex = 3;
      else if (data.segmentIndex === 5) minigameIndex = 4;
      else minigameIndex = 0;

      selectedVoucher = minigameVouchers[minigameIndex % minigameVouchers.length] || minigameVouchers[0];

      if (selectedVoucher) {
        voucherCode = selectedVoucher.code;

        // Cấp phát cho UserVoucher để user sử dụng
        await UserVoucher.create({
          userId,
          voucherId: selectedVoucher._id,
          code: selectedVoucher.code,
          isUsed: false,
          grantedReason: 'minigame',
        });
        console.log(`🎁 [Voucher Grant Minigame] Granted fixed minigame voucher ${selectedVoucher.code} to user ${userId}`);
      } else {
        won = false;
      }
    }

    // Create game session record
    const session = await MiniGameSession.create({
      userId,
      gameType: data.gameType,
      status: won ? 'won' : 'lost',
      playedAt: new Date(),
      reward: won && selectedVoucher
        ? {
            voucherCode,
            discountType: selectedVoucher.type,
            discountAmount: selectedVoucher.value,
          }
        : undefined,
    });

    return session;
  }

  /**
   * Get game history for a user
   */
  static async getHistory(userId: string) {
    return MiniGameSession.find({ userId })
      .sort({ playedAt: -1 })
      .lean();
  }

  /**
   * Get recent winning game sessions across all users
   */
  static async getRecentWins(limit = 10) {
    const sessions = await MiniGameSession.find({ status: 'won' })
      .sort({ playedAt: -1 })
      .limit(limit)
      .lean();

    // Map unique user ids
    const userIds = [...new Set(sessions.map((s) => s.userId).filter(Boolean))];

    // Find users to map names
    const User = mongoose.model('User');
    const users = await User.find({ _id: { $in: userIds } }).select('name').lean();
    const userMap = new Map(users.map((u: any) => [u._id.toString(), u.name]));

    return sessions.map((s) => ({
      _id: s._id,
      userName: s.userId ? (userMap.get(s.userId.toString()) || 'Thành viên ẩn danh') : 'Khách hàng',
      reward: s.reward,
      playedAt: s.playedAt,
    }));
  }
}
