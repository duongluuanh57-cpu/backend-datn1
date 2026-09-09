import cron from 'node-cron';
import { DiscountLifecycleService } from '../services/product/discountLifecycleService.ts';

export function startDiscountLifecycleCron() {
  // Chạy lúc 00:10 mỗi ngày — vòng đời discount theo Tag không phụ thuộc lượt truy cập
  cron.schedule('10 0 * * *', async () => {
    try {
      const result = await DiscountLifecycleService.runCycle(false);
      console.log(
        `[DiscountLifecycle] Daily: gán ${result?.assigned ?? 0}, thu hồi ${result?.reclaimed ?? 0}`
      );
    } catch (err) {
      console.error('[DiscountLifecycle] Daily error:', err);
    }
  });

  console.log('🤖 [DiscountLifecycleCron] Service initialized (daily 00:10).');
}
