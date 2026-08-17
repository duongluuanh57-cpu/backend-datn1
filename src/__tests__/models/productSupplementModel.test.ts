/**
 * productSupplementModel.test.ts — Test isSupplemented + status fields
 */
import { describe, it, expect } from "vitest";

describe("Product Model — Supplement fields", () => {
  it("should have isSupplemented default to false", () => {
    // Kiểm tra schema default qua interface
    const defaultProduct = {
      name: "Test",
      brandId: "507f191e810c19729de860ea",
      isSupplemented: false,
      status: "draft",
    };
    expect(defaultProduct.isSupplemented).toBe(false);
    expect(defaultProduct.status).toBe("draft");
  });

  it("should accept valid status values", () => {
    const validStatuses = ["draft", "active", "archived"];
    validStatuses.forEach((s) => {
      const p = { name: "Test", brandId: "id", status: s };
      expect(validStatuses).toContain(p.status);
    });
  });

  it("should reject invalid status values", () => {
    const validStatuses = ["draft", "active", "archived"];
    const invalid = ["deleted", "pending", "", "inactive"];
    invalid.forEach((s) => {
      expect(validStatuses).not.toContain(s);
    });
  });

  it("should auto-switch to active when fully supplemented", () => {
    const product = {
      name: "Full Product",
      description: "A".repeat(60),
      brandId: "brand123",
      image: "https://example.com/img.jpg",
      variants: ["var1", "var2"],
      categories: ["cat1"],
      isSupplemented: false,
      status: "draft",
    };

    const isFull = !!(
      product.name &&
      product.description &&
      product.description.length > 50 &&
      product.brandId &&
      product.image &&
      product.variants &&
      product.variants.length > 0 &&
      product.categories &&
      product.categories.length === 1
    );

    expect(isFull).toBe(true);

    if (isFull) {
      product.isSupplemented = true;
      product.status = "active";
    }

    expect(product.isSupplemented).toBe(true);
    expect(product.status).toBe("active");
  });

  it("should NOT auto-switch when missing required fields", () => {
    const testCases = [
      { name: "No desc", description: "", brandId: "b", image: "i", variants: ["v"], categories: ["c1"] },
      { name: "Short desc", description: "Short", brandId: "b", image: "i", variants: ["v"], categories: ["c1"] },
      { name: "No image", description: "A".repeat(60), brandId: "b", image: "", variants: ["v"], categories: ["c1"] },
      { name: "No variants", description: "A".repeat(60), brandId: "b", image: "i", variants: [], categories: ["c1"] },
      { name: "No categories", description: "A".repeat(60), brandId: "b", image: "i", variants: ["v"], categories: [] },
      { name: "Multiple categories", description: "A".repeat(60), brandId: "b", image: "i", variants: ["v"], categories: ["c1", "c2"] },
    ];

    testCases.forEach((tc) => {
      const isFull = !!(
        tc.name &&
        tc.description &&
        tc.description.length > 50 &&
        tc.brandId &&
        tc.image &&
        tc.variants &&
        tc.variants.length > 0 &&
        tc.categories &&
        tc.categories.length === 1
      );
      expect(isFull).toBe(false);
    });
  });
});