import { describe, it, expect } from "vitest";
import { slugify, parseSizes } from "../../../services/product/productHelpers.ts";

describe("slugify", () => {
  it("should lowercase and replace spaces with hyphens", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("should remove diacritics", () => {
    expect(slugify("Cà phê")).toBe("ca-phe");
  });

  it("should remove special characters", () => {
    expect(slugify("Chanel No.5!")).toBe("chanel-no-5");
  });

  it("should trim leading/trailing hyphens", () => {
    expect(slugify("---test---")).toBe("test");
  });
});

describe("parseSizes", () => {
  it("should parse size:price pairs", () => {
    const result = parseSizes("50ml:500000,100ml:800000");
    expect(result).toEqual([
      { size: "50ml", price: 500000 },
      { size: "100ml", price: 800000 },
    ]);
  });

  it("should handle empty input", () => {
    expect(parseSizes("")).toEqual([]);
  });

  it("should handle single size", () => {
    const result = parseSizes("50ml:250000");
    expect(result).toEqual([{ size: "50ml", price: 250000 }]);
  });

  it("should filter out entries without size", () => {
    const result = parseSizes(":100000,50ml:200000");
    expect(result.length).toBe(1);
    expect(result[0].size).toBe("50ml");
  });
});