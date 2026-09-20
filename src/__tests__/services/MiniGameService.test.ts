import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/User.ts', () => ({
  User: { findById: vi.fn(), findOneAndUpdate: vi.fn(), find: vi.fn() },
}));

vi.mock('../../models/MiniGameSession.ts', () => ({
  MiniGameSession: { create: vi.fn(), find: vi.fn(), countDocuments: vi.fn() },
  GameType: {},
}));

vi.mock('../../models/Voucher.ts', () => ({
  Voucher: { find: vi.fn() },
}));

vi.mock('../../models/UserVoucher.ts', () => ({
  UserVoucher: { create: vi.fn() },
}));

vi.mock('../../services/VoucherService.ts', () => ({
  VoucherService: { ensureDefaultMinigameVouchers: vi.fn() },
}));

import { MiniGameService } from '../../services/MiniGameService.ts';
import { User } from '../../models/User.ts';
import { MiniGameSession } from '../../models/MiniGameSession.ts';
import { Voucher } from '../../models/Voucher.ts';
import { UserVoucher } from '../../models/UserVoucher.ts';
import { VoucherService } from '../../services/VoucherService.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MiniGameService', () => {
  describe('syncUserSpinTurns', () => {
    it('grants 1 turn if user has not played today', async () => {
      const user = {
        _id: 'user1',
        spinTurns: 0,
        save: vi.fn().mockResolvedValue(true),
      };
      (User.findById as any).mockResolvedValue(user);
      (MiniGameSession.countDocuments as any).mockResolvedValue(0);

      const turns = await MiniGameService.syncUserSpinTurns('user1');
      expect(turns).toBe(1);
      expect(user.spinTurns).toBe(1);
      expect(user.save).toHaveBeenCalled();
    });

    it('sets 0 turns if user already played today', async () => {
      const user = {
        _id: 'user1',
        spinTurns: 1,
        save: vi.fn().mockResolvedValue(true),
      };
      (User.findById as any).mockResolvedValue(user);
      (MiniGameSession.countDocuments as any).mockResolvedValue(1);

      const turns = await MiniGameService.syncUserSpinTurns('user1');
      expect(turns).toBe(0);
      expect(user.spinTurns).toBe(0);
      expect(user.save).toHaveBeenCalled();
    });

    it('does not save when turns already synced', async () => {
      const user = {
        _id: 'user1',
        spinTurns: 1,
        save: vi.fn().mockResolvedValue(true),
      };
      (User.findById as any).mockResolvedValue(user);
      (MiniGameSession.countDocuments as any).mockResolvedValue(0);

      const turns = await MiniGameService.syncUserSpinTurns('user1');
      expect(turns).toBe(1);
      expect(user.save).not.toHaveBeenCalled();
    });
  });

  describe('saveResult', () => {
    it('throws for guests', async () => {
      await expect(MiniGameService.saveResult({ gameType: 'wheel', won: false }, 'guest'))
        .rejects.toThrow('đăng nhập');
    });

    it('throws when no turns left (atomic update matched nothing)', async () => {
      (User.findOneAndUpdate as any).mockResolvedValue(null);
      await expect(MiniGameService.saveResult({ gameType: 'wheel', won: false }, 'user1'))
        .rejects.toThrow('hết lượt');
    });

    it('creates session without voucher when lost', async () => {
      (User.findOneAndUpdate as any).mockResolvedValue({ _id: 'user1', spinTurns: 0 });
      (MiniGameSession.create as any).mockResolvedValue({ status: 'lost' });

      const result = await MiniGameService.saveResult({ gameType: 'wheel', won: false }, 'user1');

      expect(MiniGameSession.create).toHaveBeenCalled();
      expect(UserVoucher.create).not.toHaveBeenCalled();
      expect(result.status).toBe('lost');
    });

    it('creates session and grants voucher when won', async () => {
      (User.findOneAndUpdate as any).mockResolvedValue({ _id: 'user1', spinTurns: 0 });
      (VoucherService.ensureDefaultMinigameVouchers as any).mockResolvedValue(undefined);
      (Voucher.find as any).mockReturnValue({
        sort: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([
            { _id: 'v0', code: 'GAME-FS1', type: 'fixed', value: 0 },
            { _id: 'v1', code: 'GAME-DISC5', type: 'percentage', value: 5 },
          ]),
        }),
      });
      (UserVoucher.create as any).mockResolvedValue({});
      (MiniGameSession.create as any).mockResolvedValue({
        status: 'won',
        reward: { voucherCode: 'GAME-DISC5', discountType: 'percentage', discountAmount: 5 },
      });

      const result = await MiniGameService.saveResult(
        { gameType: 'wheel', won: true, segmentIndex: 1, discountType: 'percentage', discountAmount: 5 },
        'user1'
      );

      expect(UserVoucher.create).toHaveBeenCalled();
      const voucherArg = (UserVoucher.create as any).mock.calls[0][0];
      expect(voucherArg.code).toBe('GAME-DISC5');
      expect(voucherArg.grantedReason).toBe('minigame');
      expect(result.status).toBe('won');
    });
  });
});
