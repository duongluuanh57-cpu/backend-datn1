import { describe, it, expect, afterEach, vi } from "vitest";
import { generateCsrfToken, csrfProtection } from "../../middleware/csrfMiddleware.ts";

const originalEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalEnv;
});

describe("generateCsrfToken", () => {
  it("should generate a 64-char hex string (32 bytes)", () => {
    const token = generateCsrfToken();
    expect(token).toBeDefined();
    expect(typeof token).toBe("string");
    expect(token.length).toBe(64);
  });

  it("should generate unique tokens each time", () => {
    const t1 = generateCsrfToken();
    const t2 = generateCsrfToken();
    expect(t1).not.toBe(t2);
  });

  it("should only contain hex characters", () => {
    const token = generateCsrfToken();
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
  });
});

describe("csrfProtection", () => {
  const makeReply = () => {
    const setCookie = vi.fn();
    const reply: any = {
      statusCode: 200,
      setCookie,
      status(code: number) { reply.statusCode = code; return reply; },
      send(body: any) { reply.body = body; return reply; },
    };
    return { reply, setCookie };
  };

  it("set cookie csrf_token bằng cùng bộ attributes cross-site với cookie session", async () => {
    process.env.NODE_ENV = "production";
    const { reply, setCookie } = makeReply();

    await csrfProtection({ method: "GET", headers: {} } as any, reply);

    // SameSite=Lax_hardcode ở đây từng khiến cookie không bao giờ được gửi lại từ
    // FE Vercel → mọi POST của admin chết ở bước validate.
    expect(setCookie).toHaveBeenCalledWith(
      "csrf_token",
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.objectContaining({ sameSite: "none", secure: true, httpOnly: true, path: "/" })
    );
  });

  it("chặn POST khi token trong cookie và trong body không khớp", async () => {
    const { reply } = makeReply();
    const req = {
      method: "POST",
      headers: { cookie: "csrf_token=aaa" },
      body: { _csrf: "bbb" },
    } as any;

    await csrfProtection(req, reply);

    expect(reply.statusCode).toBe(403);
  });

  it("cho POST hợp lệ qua và gỡ _csrf khỏi body", async () => {
    const { reply } = makeReply();
    const req = {
      method: "POST",
      headers: { cookie: "csrf_token=abc123" },
      body: { _csrf: "abc123", name: "Spam" },
    } as any;

    await csrfProtection(req, reply);

    expect(reply.statusCode).toBe(200);
    expect(req.body).toEqual({ name: "Spam" });
  });
});