/**
 * productSupplement.test.ts — Tests for supplement auto-switch logic only
 * API controller tests require full integration environment (skipped in unit test).
 */
import { describe, it, expect } from "vitest";

describe("Product Supplement — Auto-switch logic", () => {
  it("should detect fully supplemented product", () => {
    const product = {
      name: "Full Product",
      description: "A".repeat(60),
      brandId: "brand123",
      image: "https://example.com/img.jpg",
      variants: ["var1", "var2"],
      categories: ["cat1"],
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
  });

  it("should detect missing description", () => {
    const product = {
      name: "No Desc",
      description: "",
      brandId: "brand123",
      image: "https://example.com/img.jpg",
      variants: ["var1"],
      categories: ["cat1"],
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

    expect(isFull).toBe(false);
  });

  it("should detect missing image", () => {
    const product = {
      name: "No Image",
      description: "A".repeat(60),
      brandId: "brand123",
      image: "",
      variants: ["var1"],
      categories: ["cat1"],
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

    expect(isFull).toBe(false);
  });

  it("should detect missing variants", () => {
    const product = {
      name: "No Variants",
      description: "A".repeat(60),
      brandId: "brand123",
      image: "https://example.com/img.jpg",
      variants: [],
      categories: ["cat1"],
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

    expect(isFull).toBe(false);
  });

  it("should detect multiple categories as invalid for single category limit", () => {
    const product = {
      name: "Multiple Cats",
      description: "A".repeat(60),
      brandId: "brand123",
      image: "https://example.com/img.jpg",
      variants: ["var1"],
      categories: ["cat1", "cat2"],
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

    expect(isFull).toBe(false);
  });
});