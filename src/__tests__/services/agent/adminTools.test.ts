/**
 * adminTools.test.ts — Unit tests for Admin CRUD tool implementations
 *
 * Test updateProductFields + error handling của dependency injection.
 * createProductFromName cần AI call → skipped in unit test (needs integration test).
 * ensureBrand cần DB + AI → skipped in unit test.
 */
import { describe, it, expect, vi } from "vitest";

const VALID_ID = "507f191e810c19729de860ea";

import { updateProductFields, AdminToolDeps } from "../../../services/agent/adminTools.ts";

describe("adminTools", () => {
  // ── updateProductFields ──
  describe("updateProductFields", () => {
    it("should return error if product not found", async () => {
      const deps: AdminToolDeps = {
        findProductById: () => Promise.resolve(null),
      };

      const result = await updateProductFields(VALID_ID, { price: 1000000 }, deps);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Không tìm thấy sản phẩm");
    });

    it("should update product successfully", async () => {
      const deps: AdminToolDeps = {
        findProductById: () => Promise.resolve({ name: "Old Name" }),
        updateProduct: () => Promise.resolve({ _id: VALID_ID }),
      };

      const result = await updateProductFields(VALID_ID, { price: 3_000_000 }, deps);

      expect(result.success).toBe(true);
      expect(result.message).toContain("Đã cập nhật sản phẩm");
      expect(result.message).toContain("Old Name");
      expect(result.data.fields).toContain("price");
    });

    it("should handle update failure (returns null)", async () => {
      const deps: AdminToolDeps = {
        findProductById: () => Promise.resolve({ name: "Existing" }),
        updateProduct: () => Promise.resolve(null),
      };

      const result = await updateProductFields(VALID_ID, { price: 1 }, deps);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Không thể cập nhật");
    });

    it("should support multiple field updates", async () => {
      const deps: AdminToolDeps = {
        findProductById: () => Promise.resolve({ name: "Multi Field" }),
        updateProduct: () => Promise.resolve({ _id: VALID_ID }),
      };

      const result = await updateProductFields(VALID_ID, {
        price: 5_000_000,
        description: "Updated description",
        discountPercentage: 20,
      }, deps);

      expect(result.success).toBe(true);
      expect(result.data.fields).toContain("price");
      expect(result.data.fields).toContain("description");
      expect(result.data.fields).toContain("discountPercentage");
    });
  });

  // ── AdminToolDeps partial injection ──
  describe("AdminToolDeps interface", () => {
    it("should support partial dependency injection", async () => {
      const partialDeps: AdminToolDeps = {
        findProductById: () => Promise.resolve(null),
      };

      const result = await updateProductFields(VALID_ID, { price: 1 }, partialDeps);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Không tìm thấy");
    });
  });

  // ── searchTrending ──
  describe("searchTrending", () => {
    it("should return error when AIService fails", async () => {
      const { AIService } = await import("../../../services/AIService.ts");
      vi.spyOn(AIService, "generateResponse").mockRejectedValueOnce(new Error("AI error"));

      const { searchTrending } = await import("../../../services/agent/adminTools.ts");
      const result = await searchTrending("Dior", undefined, 5);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Lỗi");
    });
  });
});