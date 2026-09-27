import mongoose from 'mongoose';
import { User } from '../models/User.ts';
import { Order } from '../models/Order.ts';
import { RewardTransaction, type RewardSource } from '../models/RewardTransaction.ts';
import { DailySpinService } from './DailySpinService.ts';
import { computeMemberTier, type MemberTier } from '../utils/memberTier.ts';
import { ValidationError } from '../utils/errors.ts';

export const POINTS_PER_VND = 1;

export const MEMBERSHIP_SPIN_BONUS: Record<Exclude<MemberTier, 'MEMBER'>, number> = {
  Bac: 10,
  Vang: 20,
  KimCuong: 50,
};

const TIER_ORDER: MemberTier[] = ['MEMBER', 'Bac', 'Vang', 'KimCuong'];

function tierIndex(tier: string | undefined): number {
  const index = TIER_ORDER.indexOf((tier || 'MEMBER') as MemberTier);
  return index < 0 ? 0 : index;
}

function spinBonusBetween(from: string | undefined, to: MemberTier): number {
  const start = tierIndex(from);
  const end = tierIndex(to);
  let total = 0;
  for (let i = start + 1; i <= end; i++) {
    const tier = TIER_ORDER[i];
    if (tier !== 'MEMBER') total += MEMBERSHIP_SPIN_BONUS[tier];
  }
  return total;
}

export class RewardService {
  static async getBalance(userId: string): Promise<number> {
    const user = await User.findById(userId).select('rewardPoints').lean() as any;
    if (!user) throw new ValidationError('Người dùng không tồn tại');
    return user.rewardPoints || 0;
  }

  static async earnFromMiniGame(
    userId: string,
    amount: number,
    sessionId: any,
    label?: string,
  ): Promise<number> {
    const points = Math.max(0, Math.floor(Number(amount) || 0));
    if (points === 0) return this.getBalance(userId);

    const updated = await User.findOneAndUpdate(
      { _id: userId },
      { $inc: { rewardPoints: points } },
      { new: true },
    ) as any;
    if (!updated) throw new ValidationError('Người dùng không tồn tại');

    try {
      await RewardTransaction.create({
        userId,
        type: 'earn',
        unit: 'points',
        amount: points,
        balanceAfter: updated.rewardPoints || 0,
        source: 'minigame' satisfies RewardSource,
        sessionId,
        description: label || 'Thưởng xu từ vòng quay may mắn',
      });
    } catch (error) {
      await User.updateOne({ _id: userId }, { $inc: { rewardPoints: -points } });
      throw error;
    }

    return updated.rewardPoints || 0;
  }

  /** Trừ xu khi checkout; caller ghi orderId để refund có thể idempotent. */
  static async spendForOrder(userId: string, orderId: any, amount: number): Promise<number> {
    const points = Math.max(0, Math.floor(Number(amount) || 0));
    if (points === 0) return this.getBalance(userId);

    const updated = await User.findOneAndUpdate(
      { _id: userId, rewardPoints: { $gte: points } },
      { $inc: { rewardPoints: -points } },
      { new: true },
    ) as any;
    if (!updated) throw new ValidationError('Số dư xu không đủ để thanh toán');

    try {
      await RewardTransaction.create({
        userId,
        type: 'spend',
        unit: 'points',
        amount: points,
        balanceAfter: updated.rewardPoints || 0,
        source: 'order',
        orderId,
        description: 'Dùng xu thanh toán đơn hàng',
      });
    } catch (error) {
      await User.updateOne({ _id: userId }, { $inc: { rewardPoints: points } });
      throw error;
    }

    return updated.rewardPoints || 0;
  }

  /** Hoàn xu khi hủy đơn, chỉ hoàn một lần nhờ rewardPointsRefunded trên Order. */
  static async refundForOrder(orderId: any): Promise<boolean> {
    const order = await Order.findById(orderId)
      .select('userId rewardPointsUsed rewardPointsRefunded')
      .lean() as any;
    if (!order || !order.userId || !order.rewardPointsUsed || order.rewardPointsRefunded) return false;

    const claimed = await Order.findOneAndUpdate(
      { _id: orderId, rewardPointsRefunded: { $ne: true } },
      { $set: { rewardPointsRefunded: true } },
      { new: true },
    ).lean() as any;
    if (!claimed) return false;

    const points = Math.max(0, Math.floor(Number(order.rewardPointsUsed) || 0));
    let credited = false;
    try {
      const updated = await User.findOneAndUpdate(
        { _id: order.userId },
        { $inc: { rewardPoints: points } },
        { new: true },
      ) as any;
      if (!updated) throw new Error('Không tìm thấy user để hoàn xu');
       credited = true;

      await RewardTransaction.create({
        userId: order.userId,
        type: 'refund',
        unit: 'points',
        amount: points,
        balanceAfter: updated.rewardPoints || 0,
        source: 'order',
        orderId,
        description: 'Hoàn xu khi hủy đơn hàng',
      });
      return true;
    } catch (error) {
      if (credited) {
        await User.updateOne(
          { _id: order.userId, rewardPoints: { $gte: points } },
          { $inc: { rewardPoints: -points } },
        );
      }
      await Order.updateOne({ _id: orderId }, { $set: { rewardPointsRefunded: false } });
      throw error;
    }
  }

  /**
   * Đồng bộ hạng thành viên theo tổng chi tiêu đơn delivered.
   * Khi đi lên hạng, cộng lượt quay theo từng bậc đã vượt qua.
   */
  static async syncMembershipTier(
    userId: string,
    totalSpentOverride?: number,
  ): Promise<{ tier: MemberTier; totalSpent: number; grantedSpins: number } | null> {
    let totalSpent = totalSpentOverride;
    if (totalSpent === undefined) {
      const [row] = await Order.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId), status: 'delivered' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ]);
      totalSpent = row?.total || 0;
    }
    totalSpent = Number(totalSpent) || 0;

    const user = await User.findById(userId)
      .select('memberTier membershipRewardedTier')
      .lean() as any;
    if (!user) return null;

    const newTier = computeMemberTier(totalSpent);
    const rewardedTier = (user.membershipRewardedTier || 'MEMBER') as MemberTier;
    const grantedSpins = spinBonusBetween(rewardedTier, newTier);

    if (grantedSpins <= 0) {
      await User.updateOne(
        { _id: userId },
        { $set: { memberTier: newTier, totalSpent } },
      );
      return { tier: newTier, totalSpent, grantedSpins: 0 };
    }

    const filter: any = { _id: userId };
    if (!user.membershipRewardedTier) {
      filter.$or = [
        { membershipRewardedTier: 'MEMBER' },
        { membershipRewardedTier: { $exists: false } },
      ];
    } else {
      filter.membershipRewardedTier = rewardedTier;
    }

    const updated = await User.findOneAndUpdate(
      filter,
      {
        $set: {
          memberTier: newTier,
          membershipRewardedTier: newTier,
          totalSpent,
        },
      },
      { new: true },
    ) as any;
    if (!updated) {
      return this.syncMembershipTier(userId, totalSpent);
    }

    let dailySpin: Awaited<ReturnType<typeof DailySpinService.addMembershipBonus>> | null = null;
    try {
      dailySpin = await DailySpinService.addMembershipBonus(userId, grantedSpins);
      await RewardTransaction.create({
        userId,
        type: 'membership_bonus',
        unit: 'spins',
        amount: grantedSpins,
        balanceAfter: dailySpin.remaining,
        source: 'membership',
        description: `Thưởng lượt quay lên hạng ${newTier}`,
      });
    } catch (error) {
      // Nếu ledger hoặc DailySpin không ghi được, hoàn nguyên lượt thưởng và cờ hạng
      // để lần sync sau có thể thử lại, tránh mất thưởng do lỗi DB tạm thời.
      if (dailySpin) {
        await DailySpinService.removeMembershipBonus(userId, dailySpin.day, grantedSpins);
      }
      await User.findOneAndUpdate(
        { _id: userId, membershipRewardedTier: newTier },
        { $set: { membershipRewardedTier: rewardedTier } },
      );
      console.warn('Reward membership ledger failed:', error);
    }

    return { tier: newTier, totalSpent, grantedSpins };
  }
}
