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
      return { allowed: false, reason: 'Bạn đã hết lượt quay hôm nay. Hãy quay lại vào ngày mai!' };
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
   * Đồng bộ và tính toán lượt quay của User:
   * Mỗi ngày chỉ có 1 lượt quay duy nhất.
   * Nếu không quay thì xem như bỏ qua, ngày hôm sau cấp lại 1 lượt mới chứ không cộng dồn.
   */
  static async syncUserSpinTurns(userId: string): Promise<number> {
    const user = await User.findById(userId);
    if (!user) return 0;

    // Lấy khoảng thời gian trong ngày hiện tại theo giờ Việt Nam (UTC+7)
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayVNStr = formatter.format(new Date());
    const startOfDay = new Date(`${todayVNStr}T00:00:00.000+07:00`);
    const endOfDay = new Date(`${todayVNStr}T23:59:59.999+07:00`);

    // Kiểm tra xem hôm nay user đã quay lượt nào chưa
    const playedToday = await MiniGameSession.countDocuments({
      userId,
      playedAt: { $gte: startOfDay, $lte: endOfDay },
    });

    // Mỗi ngày chỉ có đúng 1 lượt quay:
    // - Nếu hôm nay chưa quay: có 1 lượt
    // - Nếu hôm nay đã quay: còn 0 lượt
    // - Không cộng dồn từ những ngày trước
    const availableTurns = playedToday > 0 ? 0 : 1;

    if (user.spinTurns !== availableTurns) {
      user.spinTurns = availableTurns;
      user.lastDailySpinGrantedAt = new Date();
      await user.save();
    }

    return user.spinTurns ?? availableTurns;
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

    // Trừ lượt quay của user (mỗi ngày 1 lượt nên sau khi quay sẽ về 0)
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('Không tìm thấy thông tin người dùng.');
    }
    if ((user.spinTurns || 0) <= 0) {
      throw new Error('Bạn đã hết lượt quay hôm nay. Hãy quay lại vào ngày mai!');
    }
    user.spinTurns = 0;
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

        const now = new Date();
        const validityDays =
          typeof selectedVoucher.validityDays === 'number' && selectedVoucher.validityDays > 0
            ? selectedVoucher.validityDays
            : 7;
        const expiresAt = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);

        // Cấp phát cho UserVoucher để user sử dụng với ngày hết hạn cá nhân hóa
        await UserVoucher.create({
          userId,
          voucherId: selectedVoucher._id,
          code: selectedVoucher.code,
          startDate: now,
          expiresAt,
          isUsed: false,
          grantedReason: 'minigame',
        });
        console.log(`🎁 [Voucher Grant Minigame] Granted fixed minigame voucher ${selectedVoucher.code} (hết hạn sau ${validityDays} ngày: ${expiresAt.toISOString()}) to user ${userId}`);

        // Create game session record
        const session = await MiniGameSession.create({
          userId,
          gameType: data.gameType,
          status: 'won',
          playedAt: now,
          expiresAt,
          reward: {
            voucherCode,
            discountType: selectedVoucher.type,
            discountAmount: selectedVoucher.value,
          },
        });

        return session;
      } else {
        won = false;
      }
    }

    // Create game session record for lost game
    const session = await MiniGameSession.create({
      userId,
      gameType: data.gameType,
      status: 'lost',
      playedAt: new Date(),
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
