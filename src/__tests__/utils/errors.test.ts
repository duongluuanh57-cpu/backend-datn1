import { describe, it, expect } from "vitest";
import { AppError, ValidationError, UnauthorizedError } from "../../utils/errors.ts";

describe("AppError", () => {
  it("should create an AppError with message and statusCode", () => {
    const err = new AppError("Something went wrong", 500);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Something went wrong");
    expect(err.statusCode).toBe(500);
    expect(err.isOperational).toBe(true);
  });

  it("should allow non-operational errors", () => {
    const err = new AppError("Programmer error", 500, false);
    expect(err.isOperational).toBe(false);
  });
});

describe("ValidationError", () => {
  it("should have status 400", () => {
    const err = new ValidationError("Invalid input");
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe("Invalid input");
  });
});

describe("UnauthorizedError", () => {
  it("should have status 401", () => {
    const err = new UnauthorizedError("Not allowed");
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe("Not allowed");
  });
});
