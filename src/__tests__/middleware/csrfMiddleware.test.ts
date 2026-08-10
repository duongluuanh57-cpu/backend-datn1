import { describe, it, expect } from "vitest";
import { generateCsrfToken } from "../../middleware/csrfMiddleware.ts";

describe("generateCsrfToken", () => {
  it("should generate a 64-char hex string (32 bytes)", () => {
    const token = generateCsrfToken();
    expect(token).toBeDefined();
    expect(typeof token).toBe("string");
    expect(token.length).toBe(64);
  });

  it("should generate unique tokens each time", () => {
    const t1 = generateCsrfToken();
    const t2 = generateCsrfToken();
    expect(t1).not.toBe(t2);
  });

  it("should only contain hex characters", () => {
    const token = generateCsrfToken();
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
  });
});