import type { FastifyRequest, FastifyReply } from 'fastify';
import { MiniGameService } from '../services/MiniGameService.ts';
import { getUserId } from '../utils/helpers.ts';

const REWARD_SEGMENTS = [
  { discountType: 'fixed' as const,      discountAmount: 1,  label: 'Freeship Hỏa tốc' }, // Ô 0
  { discountType: 'percentage' as const, discountAmount: 5,  label: 'Voucher giảm 5%' },   // Ô 1
  { discountType: 'fixed' as const,      discountAmount: 1,  label: 'Freeship Hỏa tốc' }, // Ô 2
  { discountType: 'percentage' as const, discountAmount: 0,  label: 'May mắn' },          // Ô 3 (Trượt)
  { discountType: 'fixed' as const,      discountAmount: 1,  label: 'Freeship Hỏa tốc' }, // Ô 4
  { discountType: 'percentage' as const, discountAmount: 10, label: 'Voucher giảm 10%' },  // Ô 5
];

// Trọng số xuất hiện (tổng 100) để chọn giải thưởng ngẫu nhiên
const SEGMENTS_WEIGHTS = [
  { index: 0, weight: 15 }, // Freeship Hỏa tốc
  { index: 1, weight: 20 }, // Giảm 5%
  { index: 2, weight: 15 }, // Freeship Hỏa tốc
  { index: 3, weight: 25 }, // May mắn
  { index: 4, weight: 15 }, // Freeship Hỏa tốc
  { index: 5, weight: 10 }, // Giảm 10%
];

function pickRandomReward() {
  const totalWeight = SEGMENTS_WEIGHTS.reduce((sum, s) => sum + s.weight, 0);
  let random = Math.floor(Math.random() * totalWeight);
  for (const seg of SEGMENTS_WEIGHTS) {
    random -= seg.weight;
    if (random < 0) {
      return {
        ...REWARD_SEGMENTS[seg.index],
        segmentIndex: seg.index,
      };
    }
  }
  return {
    ...REWARD_SEGMENTS[3],
    segmentIndex: 3,
  };
}

export class MiniGameController {
  /** GET /api/mini-games/status */
  static async status(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập.' });
      }

      // Đồng bộ lượt quay trước
      const remaining = await MiniGameService.syncUserSpinTurns(userId);
      const canPlay = await MiniGameService.canPlay(userId);

      return reply.send({
        success: true,
        data: {
          remainingPlays: remaining,
          canPlay: canPlay.allowed,
          message: canPlay.allowed ? `Bạn đang có ${remaining} lượt quay.` : canPlay.reason,
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
      if (!userId) {
        return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập.' });
      }

      const { gameType } = req.body as { gameType: string };
      if (!gameType || !['wheel', 'scratch', 'dice', 'quiz'].includes(gameType)) {
        return reply.status(400).send({
          success: false,
          message: 'Loại game không hợp lệ. Chấp nhận: wheel, scratch, dice, quiz',
        });
      }

      // 1. Đồng bộ lượt quay trước
      await MiniGameService.syncUserSpinTurns(userId);

      // 2. Check xem có thể chơi không
      const canPlay = await MiniGameService.canPlay(userId);
      if (!canPlay.allowed) {
        return reply.status(400).send({
          success: false,
          message: canPlay.reason,
        });
      }

      // 3. Roll phần thưởng
      const reward = pickRandomReward();
      const won = reward.discountAmount > 0;

      // 4. Lưu kết quả game, trừ lượt quay của user, cấp UserVoucher
      const session = await MiniGameService.saveResult(
        {
          gameType: gameType as any,
          won,
          discountType: won ? reward.discountType : undefined,
          discountAmount: won ? reward.discountAmount : undefined,
          segmentIndex: reward.segmentIndex,
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
          segmentIndex: reward.segmentIndex, // Trả thêm index của ô dừng về cho client
          message: won
            ? `Chúc mừng! Bạn đã trúng thưởng ${reward.label}!`
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
      if (!userId) {
        return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập.' });
      }

      const history = await MiniGameService.getHistory(userId);
      return reply.send({ success: true, data: history });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /** GET /api/mini-games/recent-wins */
  static async recentWins(req: FastifyRequest, reply: FastifyReply) {
    try {
      const limit = Number((req.query as any).limit) || 10;
      const recent = await MiniGameService.getRecentWins(limit);
      return reply.send({ success: true, data: recent });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }
}
