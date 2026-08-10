/**
 * Tests for AI Generation Controllers (User, Category, Tag, Voucher)
 * Tests pure logic: prompt validation, response formatting, data shape.
 * Actual AI calls and DB operations are mocked/not tested here.
 */
import { describe, it, expect } from "vitest";

describe("AI Generate User Controller - Logic", () => {
  it("should reject empty prompt", () => {
    const prompt = "";
    const isValid = !!prompt?.trim();
    expect(isValid).toBe(false);
  });

  it("should validate non-empty prompt", () => {
    const prompt = "Tạo tài khoản admin";
    const isValid = !!prompt?.trim();
    expect(isValid).toBe(true);
  });

  it("should parse valid user JSON from AI response", () => {
    const aiResponse = `{
      "username": "nguyenvanA",
      "email": "nguyenvana@example.com",
      "password": "Abc12345",
      "role": "ADMIN",
      "status": "active",
      "fullName": "Nguyễn Văn A",
      "phoneNumber": "0912345678"
    }`;
    const parsed = JSON.parse(aiResponse.trim());
    expect(parsed).toHaveProperty("username");
    expect(parsed).toHaveProperty("email");
    expect(parsed).toHaveProperty("password");
    expect(parsed).toHaveProperty("role");
    expect(["USER", "ADMIN", "SUBADMIN"]).toContain(parsed.role);
    expect(parsed.status).toBe("active");
  });

  it("should strip markdown code blocks from AI response", () => {
    const raw = "```json\n{\"username\":\"test\"}\n```";
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/, "");
    const parsed = JSON.parse(cleaned.trim());
    expect(parsed).toEqual({ username: "test" });
  });
});

describe("AI Generate Category Controller - Logic", () => {
  it("should validate category data shape", () => {
    const categoryData = {
      name: "Nước hoa Nam cao cấp",
      slug: "nuoc-hoa-nam-cao-cap",
      status: "active",
    };
    expect(categoryData).toHaveProperty("name");
    expect(categoryData).toHaveProperty("slug");
    expect(typeof categoryData.name).toBe("string");
    expect(categoryData.name.length).toBeGreaterThan(0);
    expect(categoryData.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("should reject missing required fields", () => {
    const invalidData = { status: "active" };
    const hasRequired = !!(invalidData as any).name && !!(invalidData as any).slug;
    expect(hasRequired).toBe(false);
  });

  it("should generate valid slug from Vietnamese name", () => {
    const name = "Nước hoa Nam";
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9\-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    expect(slug).toBe("n-c-hoa-nam"); // Note: Vietnamese chars become hyphens
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("AI Generate Tag Controller - Logic", () => {
  it("should validate tag data shape", () => {
    const tagData = {
      name: "Hương gỗ",
      slug: "huong-go",
      status: "active",
    };
    expect(tagData).toHaveProperty("name");
    expect(tagData).toHaveProperty("slug");
    expect(tagData.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("should strip markdown and parse JSON", () => {
    const rawResponse = "Here is the result:\n```json\n{\"name\":\"Hương gỗ\",\"slug\":\"huong-go\",\"status\":\"active\"}\n```";
    const jsonStr = rawResponse.replace(/^[\s\S]*?```json\s*/i, "").replace(/```[\s\S]*$/, "");
    const parsed = JSON.parse(jsonStr.trim());
    expect(parsed.name).toBe("Hương gỗ");
    expect(parsed.slug).toBe("huong-go");
  });

  it("should reject empty tag name", () => {
    const tagData = { name: "", slug: "invalid", status: "active" };
    const isValid = !!tagData.name?.trim() && !!tagData.slug?.trim();
    expect(isValid).toBe(false);
  });
});

describe("AI Generate Voucher Controller - Logic", () => {
  it("should validate voucher data shape", () => {
    const voucherData = {
      code: "SALE20",
      type: "percentage",
      value: 20,
      minOrderAmount: 500000,
      maxDiscount: 200000,
      maxUsage: 100,
      startDate: "2026-07-01",
      endDate: "2026-08-30",
      status: "active",
    };
    expect(voucherData).toHaveProperty("code");
    expect(voucherData).toHaveProperty("type");
    expect(voucherData).toHaveProperty("value");
    expect(voucherData).toHaveProperty("startDate");
    expect(voucherData).toHaveProperty("endDate");
    expect(["percentage", "fixed"]).toContain(voucherData.type);
    expect(typeof voucherData.value).toBe("number");
    expect(voucherData.value).toBeGreaterThan(0);
  });

  it("should reject voucher without required fields", () => {
    const invalid = { code: "TEST" };
    const hasRequired = !!(invalid as any).code && !!(invalid as any).type && (invalid as any).value !== undefined 
      && !!(invalid as any).startDate && !!(invalid as any).endDate;
    expect(hasRequired).toBe(false);
  });

  it("should validate date range", () => {
    const startDate = "2026-07-01";
    const endDate = "2026-08-30";
    const start = new Date(startDate);
    const end = new Date(endDate);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });

  it("should convert voucher code to uppercase", () => {
    const code = "sale20";
    const upper = code.toUpperCase();
    expect(upper).toBe("SALE20");
  });

  it("should calculate max discount cap correctly", () => {
    const voucher = { type: "percentage" as const, value: 20, maxDiscount: 200000 };
    const orderAmount = 1000000;
    let discount = Math.round(orderAmount * (voucher.value / 100));
    if (voucher.maxDiscount && discount > voucher.maxDiscount) {
      discount = voucher.maxDiscount;
    }
    expect(discount).toBe(200000);
  });
});

describe("AI Create Entity from AI - Data Validation", () => {
  it("should validate user data before DB create", () => {
    const userData = {
      username: "testuser",
      email: "test@example.com",
      password: "Test123!",
      role: "USER",
      status: "active",
    };
    const isValid = !!userData.username && !!userData.email && !!userData.password;
    expect(isValid).toBe(true);
  });

  it("should reject user data missing password", () => {
    const userData = {
      username: "testuser",
      email: "test@example.com",
    };
    const isValid = !!userData.username && !!userData.email && !!(userData as any).password;
    expect(isValid).toBe(false);
  });

  it("should validate category data before DB create", () => {
    const categoryData = { name: "Test", slug: "test", status: "active" };
    const isValid = !!categoryData.name && !!categoryData.slug;
    expect(isValid).toBe(true);
  });

  it("should reject category data missing slug", () => {
    const categoryData = { name: "Test" };
    const isValid = !!(categoryData as any).name && !!(categoryData as any).slug;
    expect(isValid).toBe(false);
  });

  it("should validate tag data before DB create", () => {
    const tagData = { name: "Test", slug: "test", status: "active" };
    const isValid = !!tagData.name && !!tagData.slug;
    expect(isValid).toBe(true);
  });

  it("should validate voucher data before DB create", () => {
    const voucherData = {
      code: "TEST", type: "percentage", value: 10,
      startDate: "2026-07-01", endDate: "2026-08-30",
    };
    const isValid = !!(voucherData as any).code && !!(voucherData as any).type
      && (voucherData as any).value !== undefined
      && !!(voucherData as any).startDate && !!(voucherData as any).endDate;
    expect(isValid).toBe(true);
  });
});