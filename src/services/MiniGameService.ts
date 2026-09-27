import { MiniGameSession, type GameType } from '../models/MiniGameSession.ts';
import { User } from '../models/User.ts';
import { DailySpinService } from './DailySpinService.ts';
import { RewardService } from './RewardService.ts';
import { UnauthorizedError, ValidationError } from '../utils/errors.ts';

export class MiniGameService {
  /** Đồng bộ balance lượt quay theo ngày Việt Nam; không phụ thuộc cron Render. */
  static async syncUserSpinTurns(userId: string): Promise<number> {
    return DailySpinService.getRemaining(userId);
  }

  /**
   * Consume one spin and award points when the wheel lands on a winning segment.
   * Points are the only minigame reward; no voucher is created.
   */
  static async saveResult(
    data: {
      gameType: GameType;
      won: boolean;
      label?: string;
      rewardPoints?: number;
      segmentIndex?: number;
    },
    userId?: string,
  ) {
    if (!userId || userId === 'guest') {
      throw new UnauthorizedError('Vui lòng đăng nhập để lưu kết quả game.');
    }

    const consumedSpin = await DailySpinService.consume(userId);
    if (!consumedSpin) {
      throw new ValidationError('Bạn đã hết lượt quay. Hãy quay lại vào ngày mai!');
    }

    const restoreSpin = () => DailySpinService.restore(userId, consumedSpin.day);

    const points = Math.max(0, Math.floor(Number(data.rewardPoints) || 0));
    if (!data.won || points === 0) {
      try {
        return await MiniGameSession.create({
          userId,
          gameType: data.gameType,
          status: 'lost',
          playedAt: new Date(),
        });
      } catch (error) {
        await restoreSpin();
        throw error;
      }
    }

    let session: any;
    try {
      session = await MiniGameSession.create({
        userId,
        gameType: data.gameType,
        status: 'won',
        playedAt: new Date(),
        reward: {
          points,
          label: data.label,
        },
      });
    } catch (error) {
      await restoreSpin();
      throw error;
    }

    try {
      const balanceAfter = await RewardService.earnFromMiniGame(
        userId,
        points,
        session._id,
        data.label,
      );
      session.reward = { points, label: data.label, balanceAfter };
      await session.save();
      return session;
    } catch (error) {
      await MiniGameSession.deleteOne({ _id: session._id });
      await restoreSpin();
      throw error;
    }
  }

  static async getHistory(userId: string) {
    return MiniGameSession.find({ userId })
      .sort({ playedAt: -1 })
      .lean();
  }

  static async getRecentWins(limit = 10) {
    const sessions = await MiniGameSession.find({ status: 'won' })
      .sort({ playedAt: -1 })
      .limit(limit)
      .lean();

    const userIds = [...new Set(sessions.map((s) => s.userId).filter(Boolean))];
    const users = await User.find({ _id: { $in: userIds } }).select('fullName username').lean();
    const userMap = new Map(
      users.map((u: any) => [u._id.toString(), u.fullName || u.username || 'Thành viên ẩn danh']),
    );

    return sessions.map((s) => ({
      _id: s._id,
      userName: s.userId ? (userMap.get(s.userId.toString()) || 'Thành viên ẩn danh') : 'Khách hàng',
      reward: s.reward,
      playedAt: s.playedAt,
    }));
  }
}
