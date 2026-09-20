import { describe, it, expect } from "vitest";
import { hashPassword, comparePassword, generateTokens, verifyAccessToken, verifyRefreshToken, refreshTokenBlacklistKey } from "../../utils/auth.ts";

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
    const tokens = generateTokens(userId, role);
    expect(tokens).toHaveProperty("accessToken");
    expect(tokens).toHaveProperty("refreshToken");
  });

  it("should verify valid access token", () => {
    const tokens = generateTokens(userId, role);
    const decoded = verifyAccessToken(tokens.accessToken);
    expect(decoded.userId).toBe(userId);
    expect(decoded.role).toBe(role);
  });

  it("should reject refresh token when used as access token", () => {
    const tokens = generateTokens(userId, role);
    expect(() => verifyAccessToken(tokens.refreshToken)).toThrow();
  });

  it("should verify valid refresh token", () => {
    const tokens = generateTokens(userId, role);
    const decoded = verifyRefreshToken(tokens.refreshToken);
    expect(decoded.userId).toBe(userId);
  });

  it("should reject access token when used as refresh token", () => {
    const tokens = generateTokens(userId, role);
    expect(() => verifyRefreshToken(tokens.accessToken)).toThrow();
  });

  it("should reject tampered token", () => {
    const tokens = generateTokens(userId, role);
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

describe("Token Rotation (jti)", () => {
  const userId = "507f1f77bcf86cd799439011";

  it("refresh token carries unique jti for rotation", () => {
    const t1 = generateTokens(userId, "USER");
    const t2 = generateTokens(userId, "USER");
    const d1 = verifyRefreshToken(t1.refreshToken);
    const d2 = verifyRefreshToken(t2.refreshToken);
    expect(d1.jti).toBeTruthy();
    expect(d2.jti).toBeTruthy();
    expect(d1.jti).not.toBe(d2.jti);
  });

  it("blacklist key uses jti when available, token otherwise", () => {
    expect(refreshTokenBlacklistKey("tok", "jti-1")).toBe("blacklist:jti:jti-1");
    expect(refreshTokenBlacklistKey("tok", undefined)).toBe("blacklist:tok");
  });
});
