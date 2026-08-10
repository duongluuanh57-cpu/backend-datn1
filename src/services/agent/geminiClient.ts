/**
 * Gemini Client Pool — Round-Robin Load Balancer cho Gemini API
 *
 * Quản lý nhiều API key, xoay vòng mỗi request để tránh rate-limit.
 * Key nào bị rate-limit (429) sẽ tự động skip, chuyển sang key tiếp theo.
 *
 * Cấu hình trong .env:
 *   GEMINI_API_KEY=key1
 *   GEMINI_API_KEY_2=key2
 *   GEMINI_API_KEY_3=key3
 *   GEMINI_API_KEY_4=key4
 *   GEMINI_API_KEY_5=key5
 *   GEMINI_API_KEY_6=key6
 */
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

// ── Config ──────────────────────────────────────────────────────────────
const API_KEY_NAMES = [
  'GEMINI_API_KEY',
  'GEMINI_API_KEY_2',
  'GEMINI_API_KEY_3',
  'GEMINI_API_KEY_4',
  'GEMINI_API_KEY_5',
  'GEMINI_API_KEY_6',
];

const DEFAULT_MODEL = 'gemini-3.1-flash-lite-preview';

// ── State ────────────────────────────────────────────────────────────────
let currentIndex = 0;
const rateLimitBlacklist = new Map<string, number>(); // key → blacklisted_until_timestamp
const RATE_LIMIT_COOLDOWN_MS = 30_000; // 30s blacklist

// ── Helpers ──────────────────────────────────────────────────────────────

/** Lấy tất cả API keys hợp lệ (không rỗng) từ env */
function getAllApiKeys(): string[] {
  const keys: string[] = [];
  for (const name of API_KEY_NAMES) {
    const value = process.env[name];
    if (value && value.trim() && !value.includes('your_')) {
      keys.push(value.trim());
    }
  }
  return keys;
}

/** Lấy API key kế tiếp theo round-robin, bỏ qua key bị rate-limit */
function getNextApiKey(): string | null {
  const keys = getAllApiKeys();
  if (keys.length === 0) return null;

  const now = Date.now();

  // Dọn blacklist hết hạn
  for (const [key, until] of rateLimitBlacklist.entries()) {
    if (now > until) rateLimitBlacklist.delete(key);
  }

  // Thử từng key trong vòng tròn
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const idx = (currentIndex + attempt) % keys.length;
    const key = keys[idx];
    if (!rateLimitBlacklist.has(key)) {
      currentIndex = (idx + 1) % keys.length; // tiến lên cho lần sau
      return key;
    }
  }

  // Tất cả đều bị rate-limit → dùng key đầu tiên (best effort)
  console.warn('⚠️ [GeminiClient] All API keys are rate-limited! Using key #1.');
  return keys[0];
}

/** Đánh dấu key bị rate-limit */
function blacklistKey(apiKey: string): void {
  rateLimitBlacklist.set(apiKey, Date.now() + RATE_LIMIT_COOLDOWN_MS);
  console.warn(`⏳ [GeminiClient] Rate-limited! Blacklisted key for ${RATE_LIMIT_COOLDOWN_MS / 1000}s`);
}

// ── Public API ───────────────────────────────────────────────────────────

export interface GeminiClient {
  model: LanguageModel;
  provider: ReturnType<typeof createGoogleGenerativeAI>;
}

/**
 * Lấy Gemini client với API key được chọn theo round-robin.
 * Dùng `getGeminiClient()` thay vì tạo provider mỗi lần.
 */
export function getGeminiClient(modelName = DEFAULT_MODEL): GeminiClient {
  const apiKey = getNextApiKey();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set. Please configure at least one Gemini API key in .env'
    );
  }

  const provider = createGoogleGenerativeAI({ apiKey });
  const model = provider.interactions(modelName);

  return { model, provider };
}

/**
 * Kiểm tra nếu đây là lỗi rate-limit (HTTP 429).
 * Nếu đúng → tự động blacklist key hiện tại.
 * Gọi function này trong catch block của Gemini call.
 */
export function handleGeminiError(error: unknown, apiKey: string): void {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('429') || msg.includes('RATE_LIMIT') || msg.includes('quota')) {
    blacklistKey(apiKey);
  }
}

/**
 * Lấy số API keys đang active (dùng cho logging/monitoring)
 */
export function getActiveKeyCount(): number {
  return getAllApiKeys().length;
}

/**
 * Reset rate-limit blacklist (dùng cho test hoặc maintenance)
 */
export function resetRateLimitBlacklist(): void {
  rateLimitBlacklist.clear();
  currentIndex = 0;
}