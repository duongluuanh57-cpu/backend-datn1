import { describe, it, expect } from "vitest";
import { isRedisAvailable } from "../../config/redis.ts";

describe("redis config", () => {
  it("should export isRedisAvailable function", () => {
    expect(typeof isRedisAvailable).toBe("function");
  });

  it("should return a boolean", () => {
    const result = isRedisAvailable();
    expect(typeof result).toBe("boolean");
  });
});