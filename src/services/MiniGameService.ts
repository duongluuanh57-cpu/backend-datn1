import { MiniGameSession, type GameType } from '../models/MiniGameSession.ts';
import { Voucher } from '../models/Voucher.ts';
import { UserVoucher } from '../models/UserVoucher.ts';
import { User } from '../models/User.ts';
import { VoucherService } from './VoucherService.ts';
import { UnauthorizedError, ValidationError } from '../utils/errors.ts';

// Ô quay -> index trong mảng 5 voucher minigame (sort theo createdAt)
const SEGMENT_VOUCHER_INDEX = [0, 1, 2, 0, 3, 4];

export class MiniGameService {
  /**
   * Đồng bộ lượt quay của User: mỗi ngày chỉ có 1 lượt, không cộng dồn.
   */
  static async syncUserSpinTurns(userId: string): Promise<number> {
    const user = await User.findById(userId);
    if (!user) return 0;

    // Khoảng thời gian ngày hiện tại theo giờ Việt Nam (UTC+7)
    const todayVNStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const startOfDay = new Date(`${todayVNStr}T00:00:00.000+07:00`);
    const endOfDay = new Date(`${todayVNStr}T23:59:59.999+07:00`);

    const playedToday = await MiniGameSession.countDocuments({
      userId,
      playedAt: { $gte: startOfDay, $lte: endOfDay },
    });

    const availableTurns = playedToday > 0 ? 0 : 1;

    if (user.spinTurns !== availableTurns) {
      user.spinTurns = availableTurns;
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
      label?: string;
      discountType?: 'percentage' | 'fixed';
      discountAmount?: number;
      segmentIndex?: number;
    },
    userId?: string
  ) {
    if (!userId || userId === 'guest') {
      throw new UnauthorizedError('Vui lòng đăng nhập để lưu kết quả game.');
    }

    // Trừ lượt quay atomic: chỉ thành công khi còn lượt, chặn race 2 request song song
    const user = await User.findOneAndUpdate(
      { _id: userId, spinTurns: { $gt: 0 } },
      { $set: { spinTurns: 0 } },
      { new: true }
    );
    if (!user) {
      throw new ValidationError('Bạn đã hết lượt quay hôm nay. Hãy quay lại vào ngày mai!');
    }

    let selectedVoucher = null;

    if (data.won) {
      await VoucherService.ensureDefaultMinigameVouchers();

      const minigameVouchers = await Voucher.find({
        applicableTo: 'minigame',
        status: 'active',
      }).sort({ createdAt: 1 }).lean();

      if (minigameVouchers.length > 0) {
        const idx = SEGMENT_VOUCHER_INDEX[data.segmentIndex ?? 0] ?? 0;
        selectedVoucher = minigameVouchers[idx % minigameVouchers.length];
      }
    }

    if (selectedVoucher) {
      const now = new Date();
      const validityDays =
        typeof selectedVoucher.validityDays === 'number' && selectedVoucher.validityDays > 0
          ? selectedVoucher.validityDays
          : 7;
      const expiresAt = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);

      await UserVoucher.create({
        userId,
        voucherId: selectedVoucher._id,
        code: selectedVoucher.code,
        startDate: now,
        expiresAt,
        isUsed: false,
        grantedReason: 'minigame',
      });

      return MiniGameSession.create({
        userId,
        gameType: data.gameType,
        status: 'won',
        playedAt: now,
        expiresAt,
        reward: {
          voucherCode: selectedVoucher.code,
          discountType: selectedVoucher.type,
          discountAmount: selectedVoucher.value,
          label: data.label,
        },
      });
    }

    return MiniGameSession.create({
      userId,
      gameType: data.gameType,
      status: 'lost',
      playedAt: new Date(),
    });
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

    const userIds = [...new Set(sessions.map((s) => s.userId).filter(Boolean))];
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
