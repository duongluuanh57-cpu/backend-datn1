import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MiniGameController } from '../../controllers/MiniGameController.ts';
import { MiniGameService } from '../../services/MiniGameService.ts';
import * as helpers from '../../utils/helpers.ts';

describe('MiniGameController', () => {
  let mockReq: any;
  let mockReply: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReq = {
      user: { id: 'user123' },
      query: {},
      body: { gameType: 'wheel' },
    };
    mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    vi.spyOn(helpers, 'getUserId').mockReturnValue('user123');
    vi.spyOn(MiniGameService, 'syncUserSpinTurns').mockResolvedValue(1);
  });

  describe('status', () => {
    it('returns 401 when not logged in', async () => {
      vi.spyOn(helpers, 'getUserId').mockReturnValue(null as any);

      await MiniGameController.status(mockReq, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: 'Vui lòng đăng nhập.' })
      );
    });

    it('returns remaining plays when authenticated', async () => {
      vi.spyOn(MiniGameService, 'syncUserSpinTurns').mockResolvedValue(3);
      vi.spyOn(MiniGameService, 'canPlay').mockResolvedValue({ allowed: true, spinTurns: 3 } as any);

      await MiniGameController.status(mockReq, mockReply);

      expect(mockReply.send).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          remainingPlays: 3,
          canPlay: true,
        }),
      });
    });
  });

  describe('play', () => {
    it('returns 400 when user has no turns left', async () => {
      vi.spyOn(MiniGameService, 'canPlay').mockResolvedValue({
        allowed: false,
        reason: 'Hết lượt quay hôm nay.',
      });

      await MiniGameController.play(mockReq, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: 'Hết lượt quay hôm nay.' })
      );
    });

    it('processes spin and returns reward when allowed', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.01);
      vi.spyOn(MiniGameService, 'canPlay').mockResolvedValue({ allowed: true, spinTurns: 1 } as any);
      vi.spyOn(MiniGameService, 'saveResult').mockResolvedValue({
        voucherCode: 'MG-VOUCHER10',
      } as any);

      await MiniGameController.play(mockReq, mockReply);

      expect(MiniGameService.saveResult).toHaveBeenCalled();
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            won: true,
          }),
        })
      );
    });
  });

  describe('history', () => {
    it('returns user game history', async () => {
      vi.spyOn(MiniGameService, 'getHistory').mockResolvedValue([
        { _id: 'h1', isWinner: true, rewardLabel: 'Giảm 5%' },
      ] as any);

      await MiniGameController.history(mockReq, mockReply);

      expect(mockReply.send).toHaveBeenCalledWith({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({ isWinner: true }),
        ]),
      });
    });
  });
});
