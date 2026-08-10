import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/User.ts', () => ({
  User: { findById: vi.fn() },
}));

vi.mock('../../models/MiniGameSession.ts', () => ({
  MiniGameSession: { create: vi.fn(), find: vi.fn() },
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
  describe('canPlay', () => {
    it('blocks guests', async () => {
      const result = await MiniGameService.canPlay('guest');
      expect(result.allowed).toBe(false);
    });

    it('blocks when user not found', async () => {
      (User.findById as any).mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
      const result = await MiniGameService.canPlay('user1');
      expect(result.allowed).toBe(false);
    });

    it('blocks when no spin turns left', async () => {
      (User.findById as any).mockReturnValue({ lean: vi.fn().mockResolvedValue({ spinTurns: 0 }) });
      const result = await MiniGameService.canPlay('user1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('hết lượt');
    });

    it('allows play when spin turns available', async () => {
      (User.findById as any).mockReturnValue({ lean: vi.fn().mockResolvedValue({ spinTurns: 3 }) });
      const result = await MiniGameService.canPlay('user1');
      expect(result.allowed).toBe(true);
      expect(result.spinTurns).toBe(3);
    });
  });

  describe('getRemainingPlays', () => {
    it('returns 0 for guests', async () => {
      expect(await MiniGameService.getRemainingPlays('guest')).toBe(0);
    });

    it('returns remaining spin turns', async () => {
      (User.findById as any).mockReturnValue({
        select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ spinTurns: 2 }) }),
      });
      expect(await MiniGameService.getRemainingPlays('u1')).toBe(2);
    });
  });

  describe('saveResult', () => {
    const mockUser = {
      _id: 'user1',
      spinTurns: 2,
      save: vi.fn().mockResolvedValue(true),
    };

    it('throws for guests', async () => {
      await expect(MiniGameService.saveResult({ gameType: 'scratch' as any, won: false }, 'guest'))
        .rejects.toThrow('đăng nhập');
    });

    it('throws when user not found', async () => {
      (User.findById as any).mockResolvedValue(null);
      await expect(MiniGameService.saveResult({ gameType: 'scratch' as any, won: false }, 'user1'))
        .rejects.toThrow('Không tìm thấy');
    });

    it('throws when no turns left', async () => {
      (User.findById as any).mockResolvedValue({ ...mockUser, spinTurns: 0 });
      await expect(MiniGameService.saveResult({ gameType: 'scratch' as any, won: false }, 'user1'))
        .rejects.toThrow('hết lượt');
    });

    it('creates session without voucher when lost', async () => {
      (User.findById as any).mockResolvedValue(mockUser);
      (MiniGameSession.create as any).mockResolvedValue({ status: 'lost' });

      const result = await MiniGameService.saveResult({ gameType: 'scratch' as any, won: false }, 'user1');

      expect(MiniGameSession.create).toHaveBeenCalled();
      expect(UserVoucher.create).not.toHaveBeenCalled();
      expect(result.status).toBe('lost');
      expect(mockUser.save).toHaveBeenCalled();
    });

    it('creates session and grants voucher when won', async () => {
      (User.findById as any).mockResolvedValue(mockUser);
      (VoucherService.ensureDefaultMinigameVouchers as any).mockResolvedValue(undefined);
      (Voucher.find as any).mockReturnValue({
        sort: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([
            { _id: 'v1', code: 'MG-ABC123', type: 'fixed', value: 50000 },
          ]),
        }),
      });
      (UserVoucher.create as any).mockResolvedValue({});
      (MiniGameSession.create as any).mockResolvedValue({
        status: 'won',
        reward: { voucherCode: 'MG-ABC123', discountType: 'fixed', discountAmount: 50000 },
      });

      const result = await MiniGameService.saveResult(
        { gameType: 'scratch' as any, won: true, discountType: 'fixed', discountAmount: 50000 },
        'user1'
      );

      expect(UserVoucher.create).toHaveBeenCalled();
      const voucherArg = (UserVoucher.create as any).mock.calls[0][0];
      expect(voucherArg.code).toBe('MG-ABC123');
      expect(voucherArg.grantedReason).toBe('minigame');
      expect(result.status).toBe('won');
    });
  });
});
