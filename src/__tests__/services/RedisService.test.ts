import { describe, it, expect } from "vitest";
import { redisService } from "../../services/RedisService.ts";

describe("RedisService", () => {
  describe("generateKey", () => {
    it("should generate a deterministic key for the same input", () => {
      const key1 = redisService.generateKey("Hello World");
      const key2 = redisService.generateKey("Hello World");
      expect(key1).toBe(key2);
    });

    it("should normalize case", () => {
      const key1 = redisService.generateKey("Hello");
      const key2 = redisService.generateKey("hello");
      expect(key1).toBe(key2);
    });

    it("should produce strings no longer than 32 chars", () => {
      const key = redisService.generateKey("A very long input string that should be truncated");
      expect(key.length).toBeLessThanOrEqual(32);
    });

    it("should handle empty input", () => {
      const key = redisService.generateKey("");
      expect(key).toBeDefined();
      expect(typeof key).toBe("string");
    });

    it("should trim whitespace", () => {
      const key1 = redisService.generateKey("  test  ");
      const key2 = redisService.generateKey("test");
      expect(key1).toBe(key2);
    });
  });
});