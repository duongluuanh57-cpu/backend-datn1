import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/User.ts', () => ({
  User: {
    findById: vi.fn(),
    findOneAndUpdate: vi.fn(),
    find: vi.fn(),
    updateOne: vi.fn(),
  },
}));

vi.mock('../../models/MiniGameSession.ts', () => ({
  MiniGameSession: {
    create: vi.fn(),
    find: vi.fn(),
    deleteOne: vi.fn(),
  },
}));

vi.mock('../../services/DailySpinService.ts', () => ({
  DailySpinService: {
    getRemaining: vi.fn(),
    consume: vi.fn(),
    restore: vi.fn(),
  },
}));

vi.mock('../../services/RewardService.ts', () => ({
  RewardService: {
    earnFromMiniGame: vi.fn(),
  },
}));

import { MiniGameService } from '../../services/MiniGameService.ts';
import { MiniGameSession } from '../../models/MiniGameSession.ts';
import { DailySpinService } from '../../services/DailySpinService.ts';
import { RewardService } from '../../services/RewardService.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MiniGameService', () => {
  describe('syncUserSpinTurns', () => {
    it('returns the remaining balance for the current Vietnam day', async () => {
      (DailySpinService.getRemaining as any).mockResolvedValue(3);

      await expect(MiniGameService.syncUserSpinTurns('user1')).resolves.toBe(3);
      expect(DailySpinService.getRemaining).toHaveBeenCalledWith('user1');
    });
  });

  describe('saveResult', () => {
    it('rejects guests', async () => {
      await expect(
        MiniGameService.saveResult({ gameType: 'wheel', won: false }, 'guest'),
      ).rejects.toThrow('đăng nhập');
    });

    it('rejects when the daily balance is empty', async () => {
      (DailySpinService.consume as any).mockResolvedValue(null);

      await expect(
        MiniGameService.saveResult({ gameType: 'wheel', won: false }, 'user1'),
      ).rejects.toThrow('hết lượt');
    });

    it('records a lost spin from the daily balance', async () => {
      (DailySpinService.consume as any).mockResolvedValue({ day: '2026-09-25', remaining: 0 });
      (MiniGameSession.create as any).mockResolvedValue({ status: 'lost' });

      const result = await MiniGameService.saveResult(
        { gameType: 'wheel', won: false },
        'user1',
      );

      expect(result.status).toBe('lost');
      expect(DailySpinService.consume).toHaveBeenCalledWith('user1');
      expect(MiniGameSession.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'lost', userId: 'user1' }),
      );
    });

    it('restores the same day balance when session creation fails', async () => {
      (DailySpinService.consume as any).mockResolvedValue({ day: '2026-09-25', remaining: 0 });
      (MiniGameSession.create as any).mockRejectedValue(new Error('write failed'));

      await expect(
        MiniGameService.saveResult({ gameType: 'wheel', won: false }, 'user1'),
      ).rejects.toThrow('write failed');
      expect(DailySpinService.restore).toHaveBeenCalledWith('user1', '2026-09-25');
    });

    it('records points as the only winning reward', async () => {
      const session: any = {
        _id: 'session1',
        status: 'won',
        reward: { points: 5000 },
        save: vi.fn().mockResolvedValue(undefined),
      };
      (DailySpinService.consume as any).mockResolvedValue({ day: '2026-09-25', remaining: 0 });
      (MiniGameSession.create as any).mockResolvedValue(session);
      (RewardService.earnFromMiniGame as any).mockResolvedValue(5000);

      const result = await MiniGameService.saveResult(
        { gameType: 'wheel', won: true, rewardPoints: 5000, label: '5.000 xu' },
        'user1',
      );

      expect(result.reward.points).toBe(5000);
      expect(RewardService.earnFromMiniGame).toHaveBeenCalledWith(
        'user1',
        5000,
        'session1',
        '5.000 xu',
      );
    });
  });
});
