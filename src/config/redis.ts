import { Redis } from 'ioredis';

// Sử dụng chung 1 connection cho toàn bộ ứng dụng (Singleton Pattern)
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.warn('⚠️ [Redis] REDIS_URL is not defined. Redis features will be disabled.');
}

export const redis = new Redis(redisUrl || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: 3, // Thay vì null - retry tối đa 3 lần cho mỗi request
  connectTimeout: 5000, // Timeout socket connect 5s, tránh nghẽn boot khi cloud Redis lạnh
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000); // Exponential backoff: 50ms, 100ms, 150ms, max 2s
    console.warn(`⚠️ [Redis] Retrying connection (attempt ${times}), next retry in ${delay}ms`);
    return delay;
  },
  lazyConnect: true, // Không kết nối ngay lúc khởi tạo file
  enableReadyCheck: true, // Kiểm tra Redis ready trước khi dùng
  keepAlive: 30000, // Keep-alive mỗi 30s
});

let redisAvailable = true; // Track Redis availability status

redis.on('connect', () => {
  console.log('📡 Redis: Connected successfully');
  redisAvailable = true;
});

redis.on('ready', () => {
  console.log('✅ Redis: Ready to accept commands');
  redisAvailable = true;
});

redis.on('error', (err: any) => {
  console.error('❌ Redis error:', err.message);
  redisAvailable = false;
});

redis.on('close', () => {
  console.warn('⚠️ Redis: Connection closed');
  redisAvailable = false;
});

redis.on('reconnecting', () => {
  console.log('🔄 Redis: Reconnecting...');
});

export async function connectRedis() {
  try {
    // Chỉ gọi connect nếu Redis đang ở trạng thái 'wait' (chưa bắt đầu kết nối)
    if (redis.status === 'wait') {
      console.log('⏳ Connecting to Redis...');
      // Race timeout 6s để không bao giờ treo boot khi Redis không tới được
      await Promise.race([
        redis.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Redis connect timeout')), 6000)
        ),
      ]);
    }
    console.log('📡 Redis: Connection established successfully');
    redisAvailable = true;
  } catch (error) {
    if ((error as any).message !== 'Redis is already connecting/connected') {
      console.error('❌ Kết nối đến Redis thất bại:', error);
      redisAvailable = false;
    }
  }
}

// Health check function để kiểm tra Redis availability
export async function checkRedisHealth(): Promise<boolean> {
  try {
    if (redis.status !== 'ready') {
      return false;
    }
    await redis.ping();
    redisAvailable = true;
    return true;
  } catch (error) {
    console.error('❌ Redis health check failed:', error);
    redisAvailable = false;
    return false;
  }
}

// Helper function để kiểm tra Redis availability trước khi dùng
export function isRedisAvailable(): boolean {
  return redisAvailable && redis.status === 'ready';
}

// Safe Redis get với fallback
export async function safeRedisGet(key: string): Promise<string | null> {
  if (!isRedisAvailable()) {
    return null;
  }
  try {
    return await redis.get(key);
  } catch (error) {
    console.error(`❌ Redis get failed for key ${key}:`, error);
    redisAvailable = false;
    return null;
  }
}

// Safe Redis set với fallback
export async function safeRedisSet(key: string, value: string, mode?: string, duration?: number): Promise<'OK' | null> {
  if (!isRedisAvailable()) {
    return null;
  }
  try {
    if (mode && duration) {
      return await redis.set(key, value, mode as any, duration);
    }
    return await redis.set(key, value);
  } catch (error) {
    console.error(`❌ Redis set failed for key ${key}:`, error);
    redisAvailable = false;
    return null;
  }
}