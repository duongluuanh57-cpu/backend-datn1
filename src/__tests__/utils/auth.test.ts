import { describe, it, expect } from "vitest";
import { hashPassword, comparePassword, generateTokens, verifyAccessToken, verifyRefreshToken } from "../../utils/auth.ts";

describe("Password Hashing", () => {
  it("should hash a password and compare correctly", async () => {
    const password = "mySecretPassword123!";
    const hash = await hashPassword(password);
    expect(hash).toBeDefined();
    expect(hash).not.toBe(password);

    const isMatch = await comparePassword(password, hash);
    expect(isMatch).toBe(true);
  });

  it("should return false for wrong password", async () => {
    const password = "correctPassword";
    const hash = await hashPassword(password);
    const isMatch = await comparePassword("wrongPassword", hash);
    expect(isMatch).toBe(false);
  });

  it("should generate different hashes for same password", async () => {
    const hash1 = await hashPassword("samePassword");
    const hash2 = await hashPassword("samePassword");
    expect(hash1).not.toBe(hash2);
  });
});

describe("JWT Token Generation & Verification", () => {
  const userId = "507f1f77bcf86cd799439011";
  const role = "USER";

  it("should generate access and refresh tokens", () => {
    const tokens = generateTokens(userId, role, false);
    expect(tokens).toHaveProperty("accessToken");
    expect(tokens).toHaveProperty("refreshToken");
  });

  it("should generate tokens with rememberMe option", () => {
    const tokens = generateTokens(userId, role, true);
    expect(tokens.accessToken).toBeDefined();
    expect(tokens.refreshToken).toBeDefined();
  });

  it("should verify valid access token", () => {
    const tokens = generateTokens(userId, role, false);
    const decoded = verifyAccessToken(tokens.accessToken);
    expect(decoded.userId).toBe(userId);
    expect(decoded.role).toBe(role);
  });

  it("should reject refresh token when used as access token", () => {
    const tokens = generateTokens(userId, role, false);
    expect(() => verifyAccessToken(tokens.refreshToken)).toThrow();
  });

  it("should verify valid refresh token", () => {
    const tokens = generateTokens(userId, role, false);
    const decoded = verifyRefreshToken(tokens.refreshToken);
    expect(decoded.userId).toBe(userId);
  });

  it("should reject access token when used as refresh token", () => {
    const tokens = generateTokens(userId, role, false);
    expect(() => verifyRefreshToken(tokens.accessToken)).toThrow();
  });

  it("should reject tampered token", () => {
    const tokens = generateTokens(userId, role, false);
    const tampered = tokens.accessToken.slice(0, -5) + "ABCDE";
    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it("should generate admin tokens with long expiry", () => {
    const tokens = generateTokens(userId, "ADMIN");
    expect(tokens.accessToken).toBeDefined();
    const decoded = verifyAccessToken(tokens.accessToken);
    expect(decoded.role).toBe("ADMIN");
  });
});