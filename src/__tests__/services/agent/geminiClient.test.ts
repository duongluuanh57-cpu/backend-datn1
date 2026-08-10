import { describe, it, expect, beforeEach } from 'vitest';
import {
  getGeminiClient,
  getActiveKeyCount,
  resetRateLimitBlacklist,
} from '../../../services/agent/geminiClient.ts';

describe('geminiClient', () => {
  beforeEach(() => {
    resetRateLimitBlacklist();
  });

  it('should throw when no GEMINI_API_KEY is set', () => {
    // Lưu lại env cũ
    const original = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY_2;
    delete process.env.GEMINI_API_KEY_3;
    delete process.env.GEMINI_API_KEY_4;
    delete process.env.GEMINI_API_KEY_5;
    delete process.env.GEMINI_API_KEY_6;

    expect(() => getGeminiClient()).toThrow('GEMINI_API_KEY is not set');

    // Restore
    if (original) process.env.GEMINI_API_KEY = original;
  });

  it('should return a client when GEMINI_API_KEY is valid', () => {
    const original = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-api-key-valid-enough';

    const client = getGeminiClient();
    expect(client).toBeDefined();
    expect(client.model).toBeDefined();
    expect(client.provider).toBeDefined();

    if (original) process.env.GEMINI_API_KEY = original;
  });

  it('should return correct active key count', () => {
    const original = process.env.GEMINI_API_KEY;

    process.env.GEMINI_API_KEY = 'key1';
    process.env.GEMINI_API_KEY_2 = 'key2';
    expect(getActiveKeyCount()).toBe(2);

    delete process.env.GEMINI_API_KEY_2;
    expect(getActiveKeyCount()).toBe(1);

    if (original) process.env.GEMINI_API_KEY = original;
  });

  it('should ignore placeholder keys', () => {
    const original = process.env.GEMINI_API_KEY;

    process.env.GEMINI_API_KEY = 'your_gemini_api_key'; // placeholder
    expect(getActiveKeyCount()).toBe(0);

    process.env.GEMINI_API_KEY = 'real-key-123';
    expect(getActiveKeyCount()).toBe(1);

    if (original) process.env.GEMINI_API_KEY = original;
  });
});