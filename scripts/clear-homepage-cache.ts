/**
 * Script: Xóa Redis cache homepage
 *
 * Cách chạy:
 *   npx tsx scripts/clear-homepage-cache.ts
 *
 * Yêu cầu: file .env có REDIS_URL hợp lệ
 */

import { Redis } from 'ioredis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function run() {
  console.log('🔌 Đang kết nối Redis...');
  const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    connectTimeout: 10_000,
    tls: REDIS_URL.startsWith('rediss://') ? {} : undefined,
  });

  redis.on('error', (err) => {
    console.error('❌ Redis connection error:', err.message);
    process.exit(1);
  });

  await redis.ping();
  console.log('✅ Đã kết nối Redis');

  // Quét tất cả key homepage cache
  let cursor = '0';
  let deletedCount = 0;

  do {
    const [newCursor, keys] = await redis.scan(cursor, 'MATCH', 'homepage:*', 'COUNT', 100);
    cursor = newCursor;

    if (keys.length > 0) {
      await redis.del(...keys);
      deletedCount += keys.length;
      console.log(`🗑️  Đã xóa: ${keys.join(', ')}`);
    }
  } while (cursor !== '0');

  console.log(`✅ Hoàn tất. Tổng số key đã xóa: ${deletedCount}`);
  redis.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Lỗi:', err);
  process.exit(1);
});