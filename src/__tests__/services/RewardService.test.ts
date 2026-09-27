import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/User.ts', () => ({
  User: {
    findById: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateOne: vi.fn(),
  },
}));

vi.mock('../../models/Order.ts', () => ({
  Order: {
    findById: vi.fn(),
    findOneAndUpdate: vi.fn(),
    aggregate: vi.fn(),
  },
}));

vi.mock('../../models/RewardTransaction.ts', () => ({
  RewardTransaction: { create: vi.fn() },
}));

vi.mock('../../services/DailySpinService.ts', () => ({
  DailySpinService: {
    addMembershipBonus: vi.fn(),
    removeMembershipBonus: vi.fn(),
  },
}));

import { RewardService } from '../../services/RewardService.ts';
import { User } from '../../models/User.ts';
import { Order } from '../../models/Order.ts';
import { RewardTransaction } from '../../models/RewardTransaction.ts';
import { DailySpinService } from '../../services/DailySpinService.ts';

function leanQuery(value: any) {
  return { select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(value) }) };
}

beforeEach(() => vi.clearAllMocks());

describe('RewardService', () => {
  it('spends points atomically and records a ledger entry', async () => {
    (User.findOneAndUpdate as any).mockResolvedValue({ rewardPoints: 400 });
    (RewardTransaction.create as any).mockResolvedValue({});

    await expect(RewardService.spendForOrder('u1', 'o1', 600)).resolves.toBe(400);
    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'u1', rewardPoints: { $gte: 600 } },
      { $inc: { rewardPoints: -600 } },
      { new: true },
    );
    expect(RewardTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      type: 'spend', amount: 600, orderId: 'o1', balanceAfter: 400,
    }));
  });

  it('refunds points once when an order is cancelled', async () => {
    (Order.findById as any)
      .mockReturnValueOnce(leanQuery({
        _id: 'o1', userId: 'u1', rewardPointsUsed: 250, rewardPointsRefunded: false,
      }))
      .mockReturnValueOnce(leanQuery({
        _id: 'o1', userId: 'u1', rewardPointsUsed: 250, rewardPointsRefunded: true,
      }));
    (Order.findOneAndUpdate as any).mockReturnValue({
      lean: vi.fn().mockResolvedValue({ _id: 'o1' }),
    });
    (User.findOneAndUpdate as any).mockResolvedValue({ rewardPoints: 1000 });
    (RewardTransaction.create as any).mockResolvedValue({});

    await expect(RewardService.refundForOrder('o1')).resolves.toBe(true);
    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'u1' },
      { $inc: { rewardPoints: 250 } },
      { new: true },
    );
    await expect(RewardService.refundForOrder('o1')).resolves.toBe(false);
  });

  it('grants membership spin bonus only on tier upgrade and stores it in DailySpin', async () => {
    (User.findById as any).mockReturnValue(leanQuery({
      memberTier: 'MEMBER', membershipRewardedTier: 'MEMBER',
    }));
    (User.findOneAndUpdate as any).mockResolvedValue({ memberTier: 'Bac' });
    (DailySpinService.addMembershipBonus as any).mockResolvedValue({
      day: '2026-09-25', remaining: 10,
    });
    (RewardTransaction.create as any).mockResolvedValue({});

    const result = await RewardService.syncMembershipTier('u1', 10_000_000);

    expect(result).toEqual({ tier: 'Bac', totalSpent: 10_000_000, grantedSpins: 10 });
    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'u1' }),
      expect.objectContaining({
        $set: expect.objectContaining({ membershipRewardedTier: 'Bac' }),
      }),
      { new: true },
    );
    expect(User.findOneAndUpdate).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $inc: expect.anything() }),
      expect.anything(),
    );
    expect(DailySpinService.addMembershipBonus).toHaveBeenCalledWith('u1', 10);
    expect(RewardTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      type: 'membership_bonus', unit: 'spins', amount: 10, balanceAfter: 10,
    }));
  });
});
