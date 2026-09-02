import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  getOrCreateAutoPilotConfig,
  generateAutoArticle,
  calculateNextRunDate,
} from '../../services/news/newsAIService.ts';

export class NewsAutoPilotController {
  /**
   * GET /api/admin/news/auto-pilot — Lấy cấu hình và logs hiện tại
   */
  static async getConfig(req: FastifyRequest, reply: FastifyReply) {
    try {
      const config = await getOrCreateAutoPilotConfig();
      return reply.send({
        success: true,
        data: config,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /**
   * PUT /api/admin/news/auto-pilot — Cập nhật cấu hình tự động đăng bài
   */
  static async updateConfig(req: FastifyRequest, reply: FastifyReply) {
    try {
      const body = req.body as any;
      const config = await getOrCreateAutoPilotConfig();

      if (body.isActive !== undefined) config.isActive = Boolean(body.isActive);
      if (Array.isArray(body.topics)) config.topics = body.topics.map((t: string) => t.trim()).filter(Boolean);
      if (Array.isArray(body.categories) && body.categories.length > 0) config.categories = body.categories;
      if (body.scheduleType) config.scheduleType = body.scheduleType;
      if (body.scheduleTime) config.scheduleTime = body.scheduleTime;
      if (Array.isArray(body.scheduleDays)) config.scheduleDays = body.scheduleDays;
      if (body.intervalHours) config.intervalHours = Math.max(1, parseInt(body.intervalHours, 10));
      if (body.publishMode) config.publishMode = body.publishMode;
      if (body.autoFeatured !== undefined) config.autoFeatured = Boolean(body.autoFeatured);
      if (body.tone) config.tone = body.tone;
      if (body.authorName) config.authorName = body.authorName.trim();

      // Recalculate next run date based on updated schedule
      config.nextRunAt = calculateNextRunDate(config);
      await config.save();

      return reply.send({
        success: true,
        message: 'Đã cập nhật cấu hình tự động đăng bài thành công',
        data: config,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/admin/news/auto-pilot/toggle — Bật / Tắt nhanh chế độ tự động
   */
  static async toggleAutoPilot(req: FastifyRequest, reply: FastifyReply) {
    try {
      const config = await getOrCreateAutoPilotConfig();
      config.isActive = !config.isActive;
      if (config.isActive) {
        config.nextRunAt = calculateNextRunDate(config);
      }
      await config.save();

      return reply.send({
        success: true,
        message: config.isActive
          ? 'Đã BẬT chế độ tự động đăng bài viết AI'
          : 'Đã TẠM DỪNG chế độ tự động đăng bài viết AI',
        data: { isActive: config.isActive, nextRunAt: config.nextRunAt },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/admin/news/auto-pilot/trigger-now — Kích hoạt AI viết và đăng bài ngay lập tức
   */
  static async triggerNow(req: FastifyRequest, reply: FastifyReply) {
    try {
      const body = (req.body as any) || {};
      const result = await generateAutoArticle({
        triggerType: 'manual',
        customTopic: body.customTopic,
        customCategory: body.customCategory,
      });

      if (!result.success) {
        return reply.status(500).send({
          success: false,
          message: result.message,
          error: result.error,
        });
      }

      return reply.send({
        success: true,
        message: result.message,
        data: result.article,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }
}
