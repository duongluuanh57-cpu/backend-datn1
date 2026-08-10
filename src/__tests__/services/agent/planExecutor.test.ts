/**
 * planExecutor.test.ts — Unit tests for Plan Executor
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DecomposedPlan } from "../../../services/agent/queryDecomposer.ts";

vi.mock("../../../services/agent/adminTools.ts", () => ({
  createProductFromName: vi.fn().mockResolvedValue({ success: true, data: { _id: "p1" }, message: "Created" }),
  updateProductFields: vi.fn().mockResolvedValue({ success: true, data: null, message: "Updated" }),
  deleteProductById: vi.fn().mockResolvedValue({ success: true, data: null, message: "Deleted" }),
  findProductsByName: vi.fn().mockResolvedValue({ success: true, data: [{ name: "Test" }], message: "Found" }),
  ensureBrand: vi.fn().mockResolvedValue({ success: true, data: { existed: true }, message: "Brand exists" }),
  searchTrending: vi.fn().mockResolvedValue({ success: true, data: { products: [{ name: "Trending" }] }, message: "Found trending" }),
}));

const TENANT_ID = "test-tenant";

describe("planExecutor", () => {
  let executePlan: typeof import("../../../services/agent/planExecutor.ts").executePlan;
  let appendSupplementLink: typeof import("../../../services/agent/planExecutor.ts").appendSupplementLink;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../../services/agent/planExecutor.ts");
    executePlan = mod.executePlan;
    appendSupplementLink = mod.appendSupplementLink;
  });

  describe("appendSupplementLink", () => {
    it("should append link when products were created", () => {
      const result = {
        success: true,
        results: [
          { stepId: 1, tool: "generate_product", success: true, skipped: false, data: null, message: "Created", description: "Create #1" },
          { stepId: 2, tool: "generate_product", success: true, skipped: false, data: null, message: "Created", description: "Create #2" },
        ],
        logs: [],
        summary: "Đã tạo 2 sản phẩm",
      };

      const summary = appendSupplementLink("Đã tạo 2 sản phẩm", result as any);
      expect(summary).toContain("Bổ sung sản phẩm");
      expect(summary).toContain("/admin/products/supplement");
      expect(summary).toContain("2 sản phẩm");
    });

    it("should NOT append link when no products created", () => {
      const result = {
        success: true,
        results: [
          { stepId: 1, tool: "ensure_brand", success: true, skipped: false, data: null, message: "OK", description: "Check brand" },
        ],
        logs: [],
        summary: "Brand đã tồn tại",
      };

      const summary = appendSupplementLink("Brand đã tồn tại", result as any);
      expect(summary).not.toContain("Bổ sung sản phẩm");
      expect(summary).toBe("Brand đã tồn tại");
    });

    it("should handle empty results", () => {
      const result = { success: true, results: [], logs: [], summary: "" };
      const summary = appendSupplementLink("", result as any);
      expect(summary).toBe("");
    });
  });

  describe("validatePlan (via executePlan)", () => {
    it("should reject plan with invalid tool name", async () => {
      const plan: DecomposedPlan = {
        isComplex: false,
        rawMessage: "Bad plan",
        steps: [{ id: 1, tool: "nonexistent_tool", args: {}, dependsOn: [], description: "Bad" }],
      };
      const result = await executePlan(plan);
      expect(result.success).toBe(false);
      expect(result.summary).toContain("không tồn tại");
    });

    it("should reject plan with circular dependency", async () => {
      const plan: DecomposedPlan = {
        isComplex: false,
        rawMessage: "Circular plan",
        steps: [
          { id: 2, tool: "ensure_brand", args: { name: "X" }, dependsOn: [2], description: "Self-dep" },
        ],
      };
      const result = await executePlan(plan);
      expect(result.success).toBe(false);
      expect(result.summary).toContain("circular");
    });
  });

  describe("single-step plan", () => {
    it("should execute a single ensure_brand step", async () => {
      const plan: DecomposedPlan = {
        isComplex: false,
        rawMessage: "Single step",
        steps: [{ id: 1, tool: "ensure_brand", args: { name: "Chanel" }, dependsOn: [], description: "Ensure brand" }],
      };
      const result = await executePlan(plan);
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].tool).toBe("ensure_brand");
      expect(result.results[0].success).toBe(true);
    });
  });

  describe("resolveArg (via executePlan)", () => {
    it("should resolve $step_N.data.field references", async () => {
      const plan: DecomposedPlan = {
        isComplex: true,
        rawMessage: "Multi step",
        steps: [
          { id: 1, tool: "ensure_brand", args: { name: "Dior" }, dependsOn: [], description: "Step 1" },
          { id: 2, tool: "generate_product", args: { name: "$step_1.data.name", brand: "Dior" }, dependsOn: [1], description: "Step 2 uses step 1" },
        ],
      };
      const result = await executePlan(plan);
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      // Step 2 should have been called with resolved args
      const { createProductFromName } = await import("../../../services/agent/adminTools.ts");
      expect(createProductFromName).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ brand: "Dior" })
      );
    });
  });
});