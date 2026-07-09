import type { FastifyRequest, FastifyReply } from 'fastify';
import { MiniGameService } from '../services/MiniGameService.ts';

function getUserId(req: FastifyRequest): string | undefined {
  return (req as any).user?._id?.toString();
}

const REWARD_SEGMENTS = [
  // Wheel of Fortune rewards
  { weight: 20, discountType: 'percentage' as const, discountAmount: 5 },
  { weight: 15, discountType: 'percentage' as const, discountAmount: 10 },
  { weight: 10, discountType: 'percentage' as const, discountAmount: 15 },
  { weight: 5, discountType: 'percentage' as const, discountAmount: 20 },
  { weight: 10, discountType: 'fixed' as const, discountAmount: 30000 },
  { weight: 5, discountType: 'fixed' as const, discountAmount: 50000 },
  { weight: 5, discountType: 'fixed' as const, discountAmount: 100000 },
  { weight: 30, discountType: 'percentage' as const, discountAmount: 0 }, // No win
];

function pickRandomReward() {
  const totalWeight = REWARD_SEGMENTS.reduce((sum, s) => sum + s.weight, 0);
  let random = Math.floor(Math.random() * totalWeight);
  for (const segment of REWARD_SEGMENTS) {
    random -= segment.weight;
    if (random < 0) return segment;
  }
  return REWARD_SEGMENTS[0];
}

export class MiniGameController {
  /** GET /api/mini-games/status */
  static async status(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = getUserId(req);
      const remaining = await MiniGameService.getRemainingPlays(userId);
      const canPlay = await MiniGameService.canPlay(userId);

      return reply.send({
        success: true,
        data: {
          remainingPlays: remaining,
          dailyLimit: MiniGameService.getDailyLimit(),
          cooldownSeconds: MiniGameService.getCooldownSeconds(),
          canPlay: canPlay.allowed,
          ...(canPlay as any).cooldownRemaining
            ? { cooldownRemaining: (canPlay as any).cooldownRemaining }
            : {},
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /** POST /api/mini-games/play */
  static async play(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = getUserId(req);
      const { gameType } = req.body as { gameType: string };

      if (!gameType || !['wheel', 'scratch', 'dice', 'quiz'].includes(gameType)) {
        return reply.status(400).send({
          success: false,
          message: 'Loại game không hợp lệ. Chấp nhận: wheel, scratch, dice, quiz',
        });
      }

      // Check daily limit + cooldown
      const canPlay = await MiniGameService.canPlay(userId);
      if (!canPlay.allowed) {
        return reply.status(429).send({
          success: false,
          message: canPlay.reason,
          ...(canPlay as any).cooldownRemaining
            ? { cooldownRemaining: (canPlay as any).cooldownRemaining }
            : {},
        });
      }

      // Determine reward (server-side random)
      const reward = pickRandomReward();
      const won = reward.discountAmount > 0;

      // Save result & create voucher
      const session = await MiniGameService.saveResult(
        {
          gameType: gameType as any,
          won,
          discountType: won ? reward.discountType : undefined,
          discountAmount: won ? reward.discountAmount : undefined,
        },
        userId
      );

      return reply.send({
        success: true,
        data: {
          won,
          voucherCode: (session as any).reward?.voucherCode,
          discountType: reward.discountType,
          discountAmount: reward.discountAmount,
          message: won
            ? `Chúc mừng! Bạn đã trúng thưởng ${
                reward.discountType === 'percentage'
                  ? `${reward.discountAmount}%`
                  : `${reward.discountAmount.toLocaleString()}đ`
              }!`
            : 'Chúc bạn may mắn lần sau!',
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /** GET /api/mini-games/history */
  static async history(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = getUserId(req);
      const history = await MiniGameService.getHistory(userId);

      return reply.send({ success: true, data: history });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }
}
