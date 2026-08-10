import { describe, it, expect } from "vitest";
import { sanitizeJsonString, extractAndFixJson } from "../../../controllers/aiCatalog/sanitizeJson.ts";

describe("sanitizeJsonString", () => {
  it("should normalize newlines", () => {
    const result = sanitizeJsonString("hello\r\nworld");
    expect(result).toBe("hello\nworld");
  });

  it("should escape newlines inside strings", () => {
    const result = sanitizeJsonString('{"key":"line1\nline2"}');
    expect(result).toContain("\\n");
  });

  it("should remove control characters", () => {
    const input = "hello" + String.fromCharCode(0x00) + "world";
    const result = sanitizeJsonString(input);
    expect(result).toBe("helloworld");
  });

  it("should remove null characters", () => {
    const result = sanitizeJsonString("hel" + String.fromCharCode(0x00) + "lo");
    expect(result).toBe("hello");
  });
});

describe("extractAndFixJson", () => {
  it("should parse a clean JSON string", () => {
    const result = extractAndFixJson('{"name":"test"}');
    expect(result).toEqual({ name: "test" });
  });

  it("should strip markdown code blocks", () => {
    const result = extractAndFixJson('```json\n{"key":"value"}\n```');
    expect(result).toEqual({ key: "value" });
  });

  it("should handle trailing commas", () => {
    const result = extractAndFixJson('{"a":1,"b":2,}');
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("should extract JSON from surrounding text", () => {
    const result = extractAndFixJson('Here is the result: {"answer":42} Thanks!');
    expect(result).toEqual({ answer: 42 });
  });

  it("should throw on completely invalid input", () => {
    expect(() => extractAndFixJson("no json here at all")).toThrow();
  });
});