import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MiniGameController } from '../../controllers/MiniGameController.ts';
import { MiniGameService } from '../../services/MiniGameService.ts';

describe('MiniGameController', () => {
  let mockReq: any;
  let mockReply: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReq = {
      user: { userId: 'user123' },
      query: {},
      body: { gameType: 'wheel' },
    };
    mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
  });

  describe('status', () => {
    it('returns remaining plays when authenticated', async () => {
      vi.spyOn(MiniGameService, 'syncUserSpinTurns').mockResolvedValue(3);

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
    it('returns 400 when gameType is not wheel', async () => {
      mockReq.body = { gameType: 'dice' };

      await MiniGameController.play(mockReq, mockReply);

      expect(mockReply.status).toHaveBeenCalledWith(400);
    });

    it('processes spin and returns reward', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.01);
      vi.spyOn(MiniGameService, 'syncUserSpinTurns').mockResolvedValue(1);
      vi.spyOn(MiniGameService, 'saveResult').mockResolvedValue({
        reward: { voucherCode: 'MG-VOUCHER10' },
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
        { _id: 'h1', status: 'won' },
      ] as any);

      await MiniGameController.history(mockReq, mockReply);

      expect(MiniGameService.getHistory).toHaveBeenCalledWith('user123');
      expect(mockReply.send).toHaveBeenCalledWith({ success: true, data: expect.any(Array) });
    });
  });
});
