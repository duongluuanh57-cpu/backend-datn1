import { describe, it, expect, beforeEach } from "vitest";
import { FuzzyMatchCache } from "../../services/FuzzyMatchCache.ts";

describe("FuzzyMatchCache", () => {
  beforeEach(() => {
    FuzzyMatchCache.invalidateAll();
  });

  describe("normalize", () => {
    it("should lowercase and trim", () => {
      expect(FuzzyMatchCache.normalize("  Hello World  ")).toBe("hello world");
    });

    it("should keep simple ascii unchanged", () => {
      expect(FuzzyMatchCache.normalize("Chanel")).toBe("chanel");
    });
  });

  describe("getOrFetch", () => {
    it("should fetch data when not cached", async () => {
      const items = [{ name: "Apple" }, { name: "Banana" }];
      const result = await FuzzyMatchCache.getOrFetch("fruits", () => Promise.resolve(items));
      expect(result.items).toEqual(items);
      expect(result.lookup.size).toBe(2);
    });

    it("should return cached data on repeated calls", async () => {
      let count = 0;
      const fetcher = async () => { count++; return [{ name: "Cached" }]; };
      await FuzzyMatchCache.getOrFetch("key", fetcher);
      expect(count).toBe(1);
      await FuzzyMatchCache.getOrFetch("key", fetcher);
      expect(count).toBe(1);
    });

    it("should re-fetch after invalidation", async () => {
      let count = 0;
      const fetcher = async () => { count++; return [{ name: "X" }]; };
      await FuzzyMatchCache.getOrFetch("k", fetcher);
      FuzzyMatchCache.invalidate("k");
      await FuzzyMatchCache.getOrFetch("k", fetcher);
      expect(count).toBe(2);
    });
  });

  describe("fuzzyFind", () => {
    it("should find exact match", () => {
      const map = new Map<string, any>();
      map.set("chanel", { name: "Chanel" });
      expect(FuzzyMatchCache.fuzzyFind("Chanel", map)!.name).toBe("Chanel");
    });

    it("should find partial match", () => {
      const map = new Map<string, any>();
      map.set("dior sauvage", { name: "Dior Sauvage" });
      expect(FuzzyMatchCache.fuzzyFind("sauvage", map)!.name).toBe("Dior Sauvage");
    });

    it("should return undefined for no match", () => {
      expect(FuzzyMatchCache.fuzzyFind("xyz", new Map())).toBeUndefined();
    });

    it("should return undefined for empty input", () => {
      expect(FuzzyMatchCache.fuzzyFind("", new Map())).toBeUndefined();
    });
  });

  describe("fuzzyFindAll", () => {
    it("should find all matching items", () => {
      const map = new Map<string, any>();
      map.set("chanel no5", { name: "Chanel No.5" });
      map.set("chanel chance", { name: "Chanel Chance" });
      map.set("dior", { name: "Dior" });
      const results = FuzzyMatchCache.fuzzyFindAll("chanel", map);
      expect(results.length).toBe(2);
    });

    it("should return empty array for no matches", () => {
      const results = FuzzyMatchCache.fuzzyFindAll("xyz", new Map());
      expect(results).toEqual([]);
    });
  });

  describe("invalidateAll", () => {
    it("should clear all cache entries", async () => {
      const fetcher = async () => [{ name: "Item" }];
      await FuzzyMatchCache.getOrFetch("k1", fetcher);
      await FuzzyMatchCache.getOrFetch("k2", fetcher);
      FuzzyMatchCache.invalidateAll();
      let count = 0;
      const f2 = async () => { count++; return [{ name: "New" }]; };
      await FuzzyMatchCache.getOrFetch("k1", f2);
      expect(count).toBe(1);
    });
  });
});