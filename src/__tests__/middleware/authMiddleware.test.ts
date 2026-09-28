import { describe, it, expect, vi, beforeEach } from "vitest";
import { authMiddleware, optionalAuthMiddleware, requireRole } from "../../middleware/authMiddleware.ts";
import { UnauthorizedError } from "../../utils/errors.ts";
import { verifyAccessToken, isSessionRevoked, extractAccessToken } from "../../utils/auth.ts";
import { UserRepository } from "../../repositories/UserRepository.ts";

vi.mock("../../utils/auth.ts", () => ({
  verifyAccessToken: vi.fn(),
  isSessionRevoked: vi.fn(),
  extractAccessToken: vi.fn(),
}));

vi.mock("../../repositories/UserRepository.ts", () => ({
  UserRepository: { findById: vi.fn() },
}));

describe("authMiddleware — admin khóa tài khoản", () => {
  const bearerReq = () => ({ headers: { authorization: "Bearer access-token" } } as any);
  const reply = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(extractAccessToken).mockImplementation((req: any) =>
      req?.headers?.authorization?.startsWith("Bearer ") ? req.headers.authorization.substring(7) : undefined,
    );
    vi.mocked(verifyAccessToken).mockReturnValue({ userId: "u1", role: "USER", iat: 1 } as any);
    vi.mocked(isSessionRevoked).mockResolvedValue(false);
  });

  it("suspended → 401 NGAY cả khi access token vẫn còn hạn", async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue({ _id: "u1", status: "suspended" } as any);

    await expect(authMiddleware(bearerReq(), reply)).rejects.toThrow("Tài khoản của bạn đã bị khóa.");
  });

  it("active → cho qua và gắn req.user", async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue({ _id: "u1", status: "active" } as any);
    const req = bearerReq();

    await authMiddleware(req, reply);

    expect(req.user).toEqual({ userId: "u1", role: "USER" });
  });

  it("user không còn trong DB → 401", async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue(null);

    await expect(authMiddleware(bearerReq(), reply)).rejects.toThrow("Người dùng không tồn tại");
  });

  it("phiên đã thu hồi → 401 trước khi đụng tới DB", async () => {
    vi.mocked(isSessionRevoked).mockResolvedValue(true);

    await expect(authMiddleware(bearerReq(), reply)).rejects.toThrow("Phiên đăng nhập đã hết hạn");
    expect(UserRepository.findById).not.toHaveBeenCalled();
  });

  it("optionalAuthMiddleware: suspended → coi như khách, không set req.user", async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue({ _id: "u1", status: "suspended" } as any);
    const req = bearerReq();

    await optionalAuthMiddleware(req);

    expect(req.user).toBeUndefined();
  });
});

describe("requireRole", () => {
  it("should throw UnauthorizedError if no user on request", async () => {
    const handler = requireRole("ADMIN");
    const req = { user: undefined } as any;
    const reply = {} as any;
    await expect(handler(req, reply)).rejects.toThrow(UnauthorizedError);
  });

  it("should return 403 if user role is not in allowed roles", async () => {
    const handler = requireRole("ADMIN");
    const req = { user: { userId: "123", role: "USER" } } as any;
    let sentStatus = 0, sentBody: any = null;
    const reply = {
      status: (code: number) => {
        sentStatus = code;
        return { send: (b: any) => { sentBody = b; } };
      },
    } as any;
    await handler(req, reply);
    expect(sentStatus).toBe(403);
    expect(sentBody.success).toBe(false);
    expect(sentBody.message).toContain("ADMIN");
  });

  it("should pass if user has required role", async () => {
    const handler = requireRole("ADMIN");
    const req = { user: { userId: "123", role: "ADMIN" } } as any;
    const reply = { status: () => ({ send: () => {} }) } as any;
    await expect(handler(req, reply)).resolves.toBeUndefined();
  });

  it("should pass for ADMIN when ADMIN is listed", async () => {
    const handler = requireRole("ADMIN");
    const req = { user: { userId: "456", role: "ADMIN" } } as any;
    const reply = { status: () => ({ send: () => {} }) } as any;
    await expect(handler(req, reply)).resolves.toBeUndefined();
  });
});