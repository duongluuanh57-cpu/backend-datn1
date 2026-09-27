import type { FastifyRequest, FastifyReply } from 'fastify';
import { MiniGameService } from '../services/MiniGameService.ts';

// Ô 3 là trượt. weight = % xác suất (tổng 100)
const SEGMENTS = [
  { label: '1.000 xu', rewardPoints: 1000, won: true, weight: 15 },
  { label: '5.000 xu', rewardPoints: 5000, won: true, weight: 20 },
  { label: '1.000 xu', rewardPoints: 1000, won: true, weight: 15 },
  { label: 'Chúc bạn may mắn', rewardPoints: 0, won: false, weight: 25 },
  { label: '1.000 xu', rewardPoints: 1000, won: true, weight: 15 },
  { label: '10.000 xu', rewardPoints: 10000, won: true, weight: 10 },
];

function pickRandomSegment() {
  let random = Math.floor(Math.random() * 100);
  for (let i = 0; i < SEGMENTS.length; i++) {
    random -= SEGMENTS[i].weight;
    if (random < 0) return { ...SEGMENTS[i], segmentIndex: i };
  }
  return { ...SEGMENTS[3], segmentIndex: 3 };
}

export class MiniGameController {
  /** GET /api/mini-games/status — auth qua preHandler, lỗi qua errorHandler global */
  static async status(req: FastifyRequest, reply: FastifyReply) {
    const remaining = await MiniGameService.syncUserSpinTurns(req.user!.userId);
    return reply.send({
      success: true,
      data: {
        remainingPlays: remaining,
        canPlay: remaining > 0,
        message: remaining > 0 ? `Bạn đang có ${remaining} lượt quay.` : 'Bạn đã hết lượt quay hôm nay. Hãy quay lại vào ngày mai!',
      },
    });
  }

  /** POST /api/mini-games/play */
  static async play(req: FastifyRequest, reply: FastifyReply) {
    const { gameType } = req.body as { gameType: string };
    if (gameType !== 'wheel') {
      return reply.status(400).send({ success: false, message: 'Loại game không hợp lệ.' });
    }

    // Cấp lượt trong ngày; saveResult tự enforce atomic "còn lượt" qua ValidationError
    await MiniGameService.syncUserSpinTurns(req.user!.userId);
    const reward = pickRandomSegment();
    const session = await MiniGameService.saveResult({ ...reward, gameType: 'wheel' }, req.user!.userId);
    const points = (session as any).reward?.points ?? reward.rewardPoints ?? 0;
    const won = reward.won && points > 0;

    return reply.send({
      success: true,
      data: {
        won,
        points,
        balance: (session as any).reward?.balanceAfter,
        label: reward.label,
        segmentIndex: won ? reward.segmentIndex : 3,
        message: won
          ? `Chúc mừng! Bạn đã nhận ${points.toLocaleString('vi-VN')} xu.`
          : 'Chúc bạn may mắn lần sau!',
      },
    });
  }

  /** GET /api/mini-games/history */
  static async history(req: FastifyRequest, reply: FastifyReply) {
    return reply.send({ success: true, data: await MiniGameService.getHistory(req.user!.userId) });
  }

  /** GET /api/mini-games/recent-wins */
  static async recentWins(req: FastifyRequest, reply: FastifyReply) {
    const limit = Number((req.query as any).limit) || 10;
    return reply.send({ success: true, data: await MiniGameService.getRecentWins(limit) });
  }
}
