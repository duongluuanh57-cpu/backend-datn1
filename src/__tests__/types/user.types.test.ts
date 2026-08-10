import { describe, it, expect } from "vitest";
import { RegisterSchema, LoginSchema, ChangePasswordSchema } from "../../types/user.types.ts";

describe("RegisterSchema", () => {
  it("should accept valid registration data", () => {
    const result = RegisterSchema.parse({
      username: "testuser",
      email: "test@example.com",
      password: "password123",
    });
    expect(result.username).toBe("testuser");
    expect(result.email).toBe("test@example.com");
    expect(result.password).toBe("password123");
  });

  it("should reject short username", () => {
    expect(() =>
      RegisterSchema.parse({ username: "ab", email: "test@example.com", password: "password123" })
    ).toThrow();
  });

  it("should reject invalid email", () => {
    expect(() =>
      RegisterSchema.parse({ username: "testuser", email: "not-an-email", password: "password123" })
    ).toThrow();
  });

  it("should reject short password", () => {
    expect(() =>
      RegisterSchema.parse({ username: "testuser", email: "test@example.com", password: "12345" })
    ).toThrow();
  });

  it("should reject empty fields", () => {
    expect(() => RegisterSchema.parse({})).toThrow();
  });
});

describe("LoginSchema", () => {
  it("should accept valid login data", () => {
    const result = LoginSchema.parse({ email: "test@example.com", password: "mypassword" });
    expect(result.email).toBe("test@example.com");
    expect(result.password).toBe("mypassword");
  });

  it("should reject invalid email", () => {
    expect(() => LoginSchema.parse({ email: "bad", password: "password" })).toThrow();
  });

  it("should reject empty password", () => {
    expect(() => LoginSchema.parse({ email: "test@example.com", password: "" })).toThrow();
  });
});

describe("ChangePasswordSchema", () => {
  it("should accept valid change password data", () => {
    const result = ChangePasswordSchema.parse({
      currentPassword: "oldpass123",
      newPassword: "newpass456",
    });
    expect(result.currentPassword).toBe("oldpass123");
    expect(result.newPassword).toBe("newpass456");
  });

  it("should reject short new password", () => {
    expect(() =>
      ChangePasswordSchema.parse({ currentPassword: "oldpass", newPassword: "12345" })
    ).toThrow();
  });

  it("should reject empty current password", () => {
    expect(() =>
      ChangePasswordSchema.parse({ currentPassword: "", newPassword: "newpassword" })
    ).toThrow();
  });
});
