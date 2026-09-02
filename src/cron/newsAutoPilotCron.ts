import cron from 'node-cron';
import { NewsAutoPilotConfig } from '../models/NewsAutoPilotConfig.ts';
import { generateAutoArticle, calculateNextRunDate } from '../services/news/newsAIService.ts';

let isRunning = false;

export function startNewsAutoPilotCron() {
  // Quét kiểm tra mỗi phút
  cron.schedule('* * * * *', async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      const config = await NewsAutoPilotConfig.findOne();
      if (!config || !config.isActive) {
        isRunning = false;
        return;
      }

      const now = Date.now();
      // Nếu chưa có nextRunAt, khởi tạo
      if (!config.nextRunAt) {
        config.nextRunAt = calculateNextRunDate(config);
        await config.save();
        isRunning = false;
        return;
      }

      // Kiểm tra xem đã đến giờ hẹn đăng bài chưa
      if (config.nextRunAt.getTime() <= now) {
        console.log(`⏰ [NewsAutoPilotCron] Triggering scheduled article publishing at ${new Date().toISOString()}...`);
        await generateAutoArticle({ triggerType: 'cron' });
      }
    } catch (err) {
      console.error('[NewsAutoPilotCron] Error executing auto pilot cron check:', err);
    } finally {
      isRunning = false;
    }
  });

  console.log('🤖 [NewsAutoPilotCron] Service initialized and running scheduled checks.');
}
