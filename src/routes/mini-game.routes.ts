import type { FastifyInstance } from 'fastify';
import { MiniGameController } from '../controllers/MiniGameController.ts';
import { authMiddleware } from '../middleware/authMiddleware.ts';

/**
 * /api/mini-games
 *
 * Public:
 *   GET   /api/mini-games/status   — Kiểm tra lượt chơi, cooldown
 *
 * Auth:
 *   POST  /api/mini-games/play     — Bắt đầu phiên chơi (server-side random)
 *   GET   /api/mini-games/history  — Lịch sử chơi của user
 */
export async function miniGameRoutes(app: FastifyInstance) {
  // Public
  app.get('/recent-wins', MiniGameController.recentWins);

  // Auth required for other mini game operations
  app.get('/status', { preHandler: authMiddleware }, MiniGameController.status);
  app.post('/play', { preHandler: authMiddleware }, MiniGameController.play);
  app.get('/history', { preHandler: authMiddleware }, MiniGameController.history);
}
