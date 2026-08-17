import { describe, it, expect, vi } from "vitest";
import { requireRole } from "../../middleware/authMiddleware.ts";
import { UnauthorizedError } from "../../utils/errors.ts";

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