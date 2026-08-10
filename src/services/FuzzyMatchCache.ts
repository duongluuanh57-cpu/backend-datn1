import { normalize } from '../utils/textNormalizer.ts';

type CacheEntry<T> = {
  items: T[];
  lookup: Map<string, T>;
  timestamp: number;
};

export class FuzzyMatchCache {
  private static store = new Map<string, CacheEntry<any>>();
  private static TTL = 5 * 60 * 1000;
  private static MAX_SIZE = 200;

  /** Levenshtein edit distance — dùng cho typo tolerance */
  static levenshtein(a: string, b: string): number {
    const la = a.length;
    const lb = b.length;
    if (la === 0) return lb;
    if (lb === 0) return la;

    const dp: number[][] = Array.from({ length: la + 1 }, () => new Array(lb + 1).fill(0));
    for (let i = 0; i <= la; i++) dp[i][0] = i;
    for (let j = 0; j <= lb; j++) dp[0][j] = j;

    for (let i = 1; i <= la; i++) {
      for (let j = 1; j <= lb; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,      // delete
          dp[i][j - 1] + 1,      // insert
          dp[i - 1][j - 1] + cost // replace
        );
      }
    }
    return dp[la][lb];
  }

  /** Normalize using shared TextNormalizer */
  static normalize(s: string): string {
    return normalize(s);
  }

  /** Dọn dẹp entry hết hạn và giới hạn kích thước */
  private static evictIfNeeded(): void {
    const now = Date.now();
    // Xóa entry hết hạn
    for (const [key, entry] of this.store) {
      if (now - entry.timestamp >= this.TTL) {
        this.store.delete(key);
      }
    }
    // Nếu vẫn vượt giới hạn, xóa entry cũ nhất (LRU-style)
    if (this.store.size >= this.MAX_SIZE) {
      let oldestKey = '';
      let oldestTime = Infinity;
      for (const [key, entry] of this.store) {
        if (entry.timestamp < oldestTime) {
          oldestTime = entry.timestamp;
          oldestKey = key;
        }
      }
      if (oldestKey) this.store.delete(oldestKey);
    }
  }

  static async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T[]>,
    nameAccessor: (item: T) => string = (item: any) => item.name
  ): Promise<{ items: T[]; lookup: Map<string, T> }> {
    const cached = this.store.get(key);
    if (cached && Date.now() - cached.timestamp < this.TTL) {
      return { items: cached.items, lookup: cached.lookup };
    }

    const items = await fetcher();
    const lookup = new Map<string, T>();
    for (const item of items) {
      lookup.set(this.normalize(nameAccessor(item)), item);
    }

    this.evictIfNeeded();
    this.store.set(key, { items, lookup, timestamp: Date.now() });
    return { items, lookup };
  }

  static fuzzyFind<T>(
    input: string,
    lookup: Map<string, T>,
    nameAccessor: (item: T) => string = (item: any) => item.name,
    maxDistance: number = 2
  ): T | undefined {
    const norm = this.normalize(input);
    if (!norm) return undefined;

    // 1. Exact match
    const exact = lookup.get(norm);
    if (exact) return exact;

    // 2. Substring containment (both directions)
    for (const [, item] of lookup) {
      const itemNorm = this.normalize(nameAccessor(item));
      if (itemNorm.includes(norm) || norm.includes(itemNorm)) return item;
    }

    // 3. Levenshtein distance (typo tolerance)
    let bestMatch: T | undefined;
    let bestDistance = Infinity;
    for (const [, item] of lookup) {
      const itemNorm = this.normalize(nameAccessor(item));
      const dist = this.levenshtein(norm, itemNorm);
      if (dist <= maxDistance && dist < bestDistance) {
        bestDistance = dist;
        bestMatch = item;
      }
    }

    return bestMatch;
  }

  static fuzzyFindAll<T>(
    input: string,
    lookup: Map<string, T>,
    nameAccessor: (item: T) => string = (item: any) => item.name,
    maxDistance: number = 2
  ): T[] {
    const norm = this.normalize(input);
    if (!norm) return [];

    const results: T[] = [];
    const seen = new Set<string>();

    // 1. Exact + substring containment
    for (const [key, item] of lookup) {
      const itemNorm = this.normalize(nameAccessor(item));
      if (itemNorm === norm || itemNorm.includes(norm) || norm.includes(itemNorm)) {
        results.push(item);
        seen.add(key);
      }
    }

    // 2. Levenshtein — add close matches not already found
    for (const [key, item] of lookup) {
      if (seen.has(key)) continue;
      const itemNorm = this.normalize(nameAccessor(item));
      const dist = this.levenshtein(norm, itemNorm);
      if (dist <= maxDistance) {
        results.push(item);
        seen.add(key);
      }
    }

    return results;
  }

  static invalidate(key: string) {
    this.store.delete(key);
  }

  static invalidateAll() {
    this.store.clear();
  }
}
