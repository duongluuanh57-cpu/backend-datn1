import { describe, it, expect, vi } from "vitest";
import { errorHandler } from "../../middleware/errorHandler.ts";
import { AppError } from "../../utils/errors.ts";

describe("errorHandler", () => {
  it("should return silently for ERR_STREAM_PREMATURE_CLOSE", () => {
    const error = { code: "ERR_STREAM_PREMATURE_CLOSE" } as any;
    const req = { log: { error: vi.fn() } } as any;
    const reply = { status: vi.fn(), send: vi.fn() } as any;
    const result = errorHandler(error, req, reply);
    expect(result).toBeUndefined();
  });

  it("should return AppError with correct statusCode and message", () => {
    const error = new AppError("Custom not found", 404);
    const req = { log: { error: vi.fn() } } as any;
    let sentStatus = 0, sentBody: any = null;
    const reply = {
      status: (code: number) => {
        sentStatus = code;
        return { send: (b: any) => { sentBody = b; } };
      },
    } as any;
    errorHandler(error as any, req, reply);
    expect(sentStatus).toBe(404);
    expect(sentBody.success).toBe(false);
    expect(sentBody.message).toBe("Custom not found");
  });

  it("should return 400 for validation errors", () => {
    const error = { validation: [{ message: "Invalid field" }], statusCode: 400 } as any;
    const req = { log: { error: vi.fn() } } as any;
    let sentStatus = 0, sentBody: any = null;
    const reply = {
      status: (code: number) => {
        sentStatus = code;
        return { send: (b: any) => { sentBody = b; } };
      },
    } as any;
    errorHandler(error, req, reply);
    expect(sentStatus).toBe(400);
    expect(sentBody.success).toBe(false);
  });

  it("should return 429 with specific message for rate-limit", () => {
    const error = { statusCode: 429 } as any;
    const req = { log: { error: vi.fn() } } as any;
    let sentStatus = 0, sentBody: any = null;
    const reply = {
      status: (code: number) => {
        sentStatus = code;
        return { send: (b: any) => { sentBody = b; } };
      },
    } as any;
    errorHandler(error, req, reply);
    expect(sentStatus).toBe(429);
    expect(sentBody.message).toContain("Vượt quá");
  });

  it("should return 500 for unknown errors", () => {
    const error = new Error("Something unexpected");
    const req = { log: { error: vi.fn() } } as any;
    let sentStatus = 0, sentBody: any = null;
    const reply = {
      status: (code: number) => {
        sentStatus = code;
        return { send: (b: any) => { sentBody = b; } };
      },
    } as any;
    errorHandler(error as any, req, reply);
    expect(sentStatus).toBe(500);
    expect(sentBody.success).toBe(false);
  });
});