/**
 * queryDecomposer.test.ts — Unit tests for Query Decomposer
 */
import { describe, it, expect, vi } from "vitest";

describe("queryDecomposer", () => {
  // ── decomposeQuery ──
  describe("decomposeQuery", () => {
    it("should return fallback plan when Gemini fails", async () => {
      // Mock generateText to throw
      vi.doMock("ai", () => ({
        generateText: vi.fn().mockRejectedValue(new Error("Gemini error")),
      }));

      // Re-import with mocks
      const { decomposeQuery } = await import("../../../services/agent/queryDecomposer.ts");
      const plan = await decomposeQuery("tạo sản phẩm test");

      expect(plan).toBeDefined();
      expect(plan.steps.length).toBe(1);
      expect(plan.steps[0].tool).toBe("generate_product");
      expect(plan.isComplex).toBe(false);
    });

    it("should return a valid DecomposedPlan structure", async () => {
      const { decomposeQuery } = await import("../../../services/agent/queryDecomposer.ts");
      const plan = await decomposeQuery("tạo sản phẩm test");

      expect(plan).toHaveProperty("isComplex");
      expect(plan).toHaveProperty("steps");
      expect(plan).toHaveProperty("rawMessage");
      expect(Array.isArray(plan.steps)).toBe(true);
      expect(plan.rawMessage).toBe("tạo sản phẩm test");

      if (plan.steps.length > 0) {
        const step = plan.steps[0];
        expect(step).toHaveProperty("id");
        expect(step).toHaveProperty("tool");
        expect(step).toHaveProperty("args");
        expect(step).toHaveProperty("dependsOn");
        expect(step).toHaveProperty("description");
        expect(typeof step.id).toBe("number");
        expect(typeof step.tool).toBe("string");
      }
    });

    it("should handle simple single-intent messages", async () => {
      const { decomposeQuery } = await import("../../../services/agent/queryDecomposer.ts");
      const plan = await decomposeQuery("tìm sản phẩm Chanel");

      expect(plan.steps.length).toBeGreaterThanOrEqual(1);
      // Should be a single step for simple find
      expect(plan.steps[0].tool).toBeDefined();
    });
  });
});