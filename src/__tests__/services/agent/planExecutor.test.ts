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
  searchTrending: vi.fn().mockResolvedValue({ success: true, data: { name: "Trending" }, message: "Found trending" }),
}));

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

    it("should NOT append link when no products were created", () => {
      const result = {
        success: true,
        results: [
          { stepId: 1, tool: "search_trending", success: true, skipped: false, data: null, message: "OK", description: "Search" },
        ],
        logs: [],
        summary: "Đã tìm thấy sản phẩm",
      };

      const summary = appendSupplementLink("Đã tìm thấy sản phẩm", result as any);
      expect(summary).not.toContain("Bổ sung sản phẩm");
    });

    it("should handle empty results", () => {
      const result = { success: true, results: [], logs: [], summary: "" };
      expect(appendSupplementLink("", result as any)).toBe("");
    });
  });

  describe("validatePlan (via executePlan)", () => {
    it("should reject plan with invalid tool name", async () => {
      const plan: DecomposedPlan = {
        isComplex: false,
        rawMessage: "Bad plan",
        steps: [{ id: 1, tool: "create_brand", args: {}, dependsOn: [], description: "Bad" }],
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
          { id: 2, tool: "search_trending", args: { brand: "X" }, dependsOn: [2], description: "Self-dep" },
        ],
      };
      const result = await executePlan(plan);
      expect(result.success).toBe(false);
      expect(result.summary).toContain("circular");
    });
  });

  describe("single-step plan", () => {
    it("should execute a single search_trending step", async () => {
      const plan: DecomposedPlan = {
        isComplex: false,
        rawMessage: "Single step",
        steps: [{ id: 1, tool: "search_trending", args: { brand: "Chanel", limit: 5 }, dependsOn: [], description: "Search" }],
      };
      const result = await executePlan(plan);
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].tool).toBe("search_trending");
      expect(result.results[0].success).toBe(true);
    });
  });

  describe("evaluateCondition (via executePlan)", () => {
    const planWith = (condition: string): DecomposedPlan => ({
      isComplex: true,
      rawMessage: "condition probe",
      steps: [
        { id: 1, tool: "search_trending", args: { brand: "Dior" }, dependsOn: [], description: "Step 1" },
        { id: 2, tool: "generate_product", args: { name: "X" }, dependsOn: [1], description: "Step 2", condition },
      ],
    });
    const ran = async (condition: string) => {
      const result = await executePlan(planWith(condition));
      return result.results[1].skipped !== true;
    };

    it("so sánh đúng thì step vẫn chạy", async () => {
      expect(await ran('$1.data.name === "Trending"')).toBe(true);
    });

    it("REGRESSION: condition dùng cú pháp $step_N phải resolve được như trong args", async () => {
      // Decomposer được dạy "$step_N...", condition chỉ nhận "$N..." sẽ coi cả biểu thức
      // là chữ thường → step bị bỏ mà plan vẫn báo thành công.
      expect(await ran('$step_1.data.name === "Trending"')).toBe(true);
    });

    it("literal nháy đơn vẫn so sánh được", async () => {
      expect(await ran("$1.data.name === 'Trending'")).toBe(true);
      expect(await ran("$1.data.name === 'Khac'")).toBe(false);
    });

    it("toán tử nằm trong giá trị có dấu nháy escape không bị tách nhầm", async () => {
      const { searchTrending } = await import("../../../services/agent/adminTools.ts");
      (searchTrending as any).mockResolvedValueOnce({
        success: true, data: { name: 'A"B' }, message: "Found trending",
      });
      // JSON.stringify của value là "A\"B" — bộ tách cũ lật sai trạng thái chuỗi tại
      // dấu \" rồi coi " === " ở trong chuỗi là toán tử ngoài cùng.
      expect(await ran('$1.data.name === "A\\"B"')).toBe(true);
    });

    it("một mình tham chiếu bước được hiểu là truthiness của giá trị", async () => {
      expect(await ran("$step_1.data.name")).toBe(true);
      expect(await ran("$step_1.data.khongTonTai")).toBe(false);
    });

    it("REGRESSION: condition là mã nguồn không được thực thi (trước đây eval bằng new Function)", async () => {
      const result = await executePlan(planWith("globalThis.__pwned = 1 === 1"));

      expect(result.results[1].skipped).toBe(true);
      expect((globalThis as any).__pwned).toBeUndefined();
    });

    it("REGRESSION: condition nhiều mệnh đề / chuỗi lạ thì bỏ step, không đoán", async () => {
      expect(await ran('$1.data.name === "Trending" && $1.success === true')).toBe(false);
      expect(await ran("xóa hết sản phẩm cũ")).toBe(false);
    });

    it("REGRESSION: path điều kiện không được leo prototype chain", async () => {
      expect(await ran('$1.constructor.name === "Object"')).toBe(false);
    });
  });

  describe("resolveArg (via executePlan)", () => {
    const refPlan = (ref: string): DecomposedPlan => ({
      isComplex: true,
      rawMessage: "Multi step",
      steps: [
        { id: 1, tool: "search_trending", args: { brand: "Dior", limit: 5 }, dependsOn: [], description: "Step 1" },
        { id: 2, tool: "generate_product", args: { name: ref, brand: "Dior" }, dependsOn: [1], description: "Step 2 uses step 1" },
      ],
    });

    it("should resolve $step_N.data.field references", async () => {
      const result = await executePlan(refPlan("$step_1.data.name"));
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      const { createProductFromName } = await import("../../../services/agent/adminTools.ts");
      expect(createProductFromName).toHaveBeenCalledWith(
        "Trending",
        expect.objectContaining({ brand: "Dior" })
      );
    });

    it("REGRESSION: arg trỏ vào prototype phải giữ nguyên chữ, không lấy được giá trị", async () => {
      await executePlan(refPlan("$step_1.constructor.name"));
      const { createProductFromName } = await import("../../../services/agent/adminTools.ts");
      expect(createProductFromName).not.toHaveBeenCalledWith("Object", expect.anything());
      expect(createProductFromName).toHaveBeenCalledWith(
        "$step_1.constructor.name",
        expect.objectContaining({ brand: "Dior" })
      );
    });
  });
});
