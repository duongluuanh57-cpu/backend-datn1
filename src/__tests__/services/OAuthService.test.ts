import { describe, it, expect } from "vitest";
import { OAuthService } from "../../services/OAuthService.ts";

describe("OAuthService", () => {
  describe("generateState", () => {
    it("should generate a 64-char hex string", () => {
      const state = OAuthService.generateState();
      expect(state).toBeDefined();
      expect(typeof state).toBe("string");
      expect(state.length).toBe(64);
      expect(/^[0-9a-f]+$/.test(state)).toBe(true);
    });

    it("should generate unique states each time", () => {
      const s1 = OAuthService.generateState();
      const s2 = OAuthService.generateState();
      expect(s1).not.toBe(s2);
    });
  });

  describe("getGoogleAuthUrl", () => {
    it("should return a valid URL with state parameter", () => {
      const url = OAuthService.getGoogleAuthUrl("test-state-123");
      expect(url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
      expect(url).toContain("state=test-state-123");
      expect(url).toContain("response_type=code");
      expect(url).toContain("scope=openid");
    });

    it("should include client_id from env", () => {
      const url = OAuthService.getGoogleAuthUrl("state");
      expect(url).toContain("client_id=");
    });
  });
});