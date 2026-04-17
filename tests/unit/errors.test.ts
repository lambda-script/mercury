import { describe, it, expect } from "vitest";
import { toErrorMessage } from "../../src/utils/errors.js";

describe("toErrorMessage", () => {
  it("returns Error.message for Error instances", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns Error.message for subclasses of Error", () => {
    class CustomError extends Error {}
    expect(toErrorMessage(new CustomError("custom"))).toBe("custom");
  });

  it("stringifies non-Error values", () => {
    expect(toErrorMessage("plain string")).toBe("plain string");
    expect(toErrorMessage(42)).toBe("42");
    expect(toErrorMessage(null)).toBe("null");
    expect(toErrorMessage(undefined)).toBe("undefined");
  });

  it("stringifies objects that are not Error instances", () => {
    expect(toErrorMessage({ code: "EPIPE" })).toBe("[object Object]");
  });
});
