import { describe, it, expect } from "vitest";
import { AIPromptSchema } from "../../types/feature.types.ts";

describe("AIPromptSchema", () => {
  it("should accept valid prompt", () => {
    const result = AIPromptSchema.parse({ prompt: "What is this perfume?" });
    expect(result.prompt).toBe("What is this perfume?");
  });

  it("should reject empty prompt", () => {
    expect(() => AIPromptSchema.parse({ prompt: "" })).toThrow();
  });

  it("should reject prompt exceeding 2000 chars", () => {
    expect(() => AIPromptSchema.parse({ prompt: "a".repeat(2001) })).toThrow();
  });

  it("should accept prompt at exactly 2000 chars", () => {
    const result = AIPromptSchema.parse({ prompt: "a".repeat(2000) });
    expect(result.prompt.length).toBe(2000);
  });
});
