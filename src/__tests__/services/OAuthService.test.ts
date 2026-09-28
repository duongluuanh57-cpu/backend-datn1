import { describe, it, expect, vi, beforeEach } from "vitest";
import { OAuthService } from "../../services/OAuthService.ts";
import { UnauthorizedError } from "../../utils/errors.ts";
import { UserRepository } from "../../repositories/UserRepository.ts";
import { generateTokens } from "../../utils/auth.ts";

vi.mock("../../repositories/UserRepository.ts", () => ({
  UserRepository: {
    findByOAuthId: vi.fn(),
    findByEmail: vi.fn(),
    findByUsername: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("../../utils/auth.ts", () => ({
  generateTokens: vi.fn(() => ({ accessToken: 'at', refreshToken: 'rt' })),
  toPublicUser: vi.fn((u: any) => ({ id: u._id, role: u.role })),
}));

// Google trả về đúng hai bước: POST /token rồi GET /userinfo
function mockGoogle(tokenBody: any, profileBody: any, ok = true) {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce({ ok, json: async () => tokenBody })
    .mockResolvedValueOnce({ ok: true, json: async () => profileBody }));
}

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

  describe("handleGoogleCallback", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.unstubAllGlobals();
    });

    it("REGRESSION A1: email Google chưa xác minh → chặn, KHÔNG link vào tài khoản email có sẵn", async () => {
      mockGoogle({ access_token: 'g-access' }, {
        id: 'g-123',
        email: 'notverified@example.com',
        verified_email: false,
        name: 'Ghost User',
      });

      await expect(OAuthService.handleGoogleCallback('code')).rejects.toThrow(UnauthorizedError);
      // Đúng chỗ hở cũ: findByEmail là bước gắn OAuth vào tài khoản đã tồn tại trong DB.
      expect(UserRepository.findByEmail).not.toHaveBeenCalled();
      expect(UserRepository.create).not.toHaveBeenCalled();
    });

    it('chặn khi Google không cấp token hoặc hồ sơ thiếu id/email', async () => {
      mockGoogle({ error: 'invalid_grant' }, null, false);
      await expect(OAuthService.handleGoogleCallback('bad-code')).rejects.toThrow(UnauthorizedError);
      expect(UserRepository.findByOAuthId).not.toHaveBeenCalled();

      mockGoogle({ access_token: 'g-access' }, { error: 'unauthorized' });
      await expect(OAuthService.handleGoogleCallback('code')).rejects.toThrow(UnauthorizedError);
      expect(UserRepository.findByOAuthId).not.toHaveBeenCalled();
    });

    it('email đã xác minh + tài khoản đã liên kết → trả user cũ, không tạo mới', async () => {
      const existing: any = { _id: '507f1f77bcf86cd799439011', role: 'USER', email: 'a@b.com' };
      vi.mocked(UserRepository.findByOAuthId).mockResolvedValue(existing);
      mockGoogle({ access_token: 'g-access' }, {
        id: 'g-123',
        email: 'a@b.com',
        verified_email: true,
        name: 'Da Co Tai Khoan',
      });

      const result = await OAuthService.handleGoogleCallback('code');

      expect(UserRepository.findByEmail).not.toHaveBeenCalled();
      expect(UserRepository.create).not.toHaveBeenCalled();
      expect(result.user).toEqual({ id: '507f1f77bcf86cd799439011', role: 'USER' });
      expect(result.tokens.accessToken).toBe('at');
    });

    it('REGRESSION: tài khoản bị admin khóa → Google login KHÔNG được cấp phiên mới', async () => {
      const locked: any = { _id: '507f1f77bcf86cd799439011', role: 'USER', email: 'a@b.com', status: 'suspended' };
      vi.mocked(UserRepository.findByOAuthId).mockResolvedValue(locked);
      mockGoogle({ access_token: 'g-access' }, {
        id: 'g-123',
        email: 'a@b.com',
        verified_email: true,
        name: 'Bi Khoa Tai Khoan',
      });

      await expect(OAuthService.handleGoogleCallback('code')).rejects.toThrow('Tài khoản của bạn đã bị khóa.');
      expect(generateTokens).not.toHaveBeenCalled();
    });

    it('email Google trả về lẫn hoa/thường → tra cứu và lưu đúng dạng lowercase', async () => {
      vi.mocked(UserRepository.findByOAuthId).mockResolvedValue(null);
      vi.mocked(UserRepository.findByEmail).mockResolvedValue(null);
      vi.mocked(UserRepository.create).mockResolvedValue({
        _id: 'new-1',
        role: 'USER',
        status: 'active',
      } as any);
      mockGoogle({ access_token: 'g-access' }, {
        id: 'g-999',
        email: 'Mixed.Case@Gmail.com',
        verified_email: true,
        name: 'Mixed Case',
      });

      await OAuthService.handleGoogleCallback('code');

      // Lệch hoa/thường thì findByEmail không thấy doc cũ và unique index cũng không chặn
      // → cùng một người thành hai tài khoản.
      expect(UserRepository.findByEmail).toHaveBeenCalledWith('mixed.case@gmail.com');
      expect(UserRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'mixed.case@gmail.com' }),
      );
    });
  });
});
