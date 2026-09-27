import { redis, isRedisAvailable } from '../config/redis.ts';

const CHAT_CACHE_TTL = 24 * 60 * 60; // 24 giờ (thay vì vĩnh viễn)
const MAX_CHAT_CACHE_KEYS = 5000; // Giới hạn tối đa 5000 key để tránh tràn RAM

class RedisService {
  private keyCount = 0;

  /**
   * Lấy dữ liệu từ cache
   */
  async get(key: string): Promise<string | null> {
    if (!isRedisAvailable()) return null;
    try {
      return await redis.get(`chat_cache:${key}`);
    } catch (err) {
      return null;
    }
  }

  /**
   * Lưu dữ liệu vào cache với TTL 24h, có giới hạn số lượng key
   */
  async set(key: string, value: string): Promise<void> {
    if (!isRedisAvailable()) return;
    try {
      // Kiểm tra giới hạn số lượng key
      if (this.keyCount >= MAX_CHAT_CACHE_KEYS) {
        // Xóa key cũ nhất nếu vượt giới hạn
        const keys = await redis.keys('chat_cache:*');
        if (keys.length >= MAX_CHAT_CACHE_KEYS) {
          const oldestKey = keys[0]; // Redis keys() trả về không theo thứ tự, nhưng đây là best-effort
          await redis.del(oldestKey);
        }
      }
      await redis.set(`chat_cache:${key}`, value, 'EX', CHAT_CACHE_TTL);
      this.keyCount++;
    } catch (err) {
      console.error('[Redis Set Error]', err);
    }
  }

  /**
   * Xoá 1 key khỏi cache (dùng khi cần thu hồi dữ liệu đã cache)
   */
  async del(key: string): Promise<void> {
    if (!isRedisAvailable()) return;
    try {
      await redis.del(`chat_cache:${key}`);
    } catch (err) {
      console.error('[Redis Del Error]', err);
    }
  }

  /**
   * Tạo mã băm đơn giản cho câu hỏi
   */
  generateKey(text: string): string {
    return Buffer.from(text.trim().toLowerCase()).toString('base64').substring(0, 32);
  }
}

export const redisService = new RedisService();
