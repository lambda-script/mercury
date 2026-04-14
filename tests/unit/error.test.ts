import { describe, it, expect } from "vitest";
import { getErrorMessage } from "../../src/utils/error.js";

describe("getErrorMessage", () => {
  it("should extract message from Error instances", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("should include cause when present", () => {
    const err = new Error("outer", { cause: "inner reason" });
    expect(getErrorMessage(err)).toBe("outer (cause: inner reason)");
  });

  it("should coerce non-Error values to string", () => {
    expect(getErrorMessage("string failure")).toBe("string failure");
    expect(getErrorMessage(42)).toBe("42");
    expect(getErrorMessage(null)).toBe("null");
    expect(getErrorMessage(undefined)).toBe("undefined");
  });

  it("should omit cause suffix when cause is absent", () => {
    const err = new Error("no cause");
    expect(getErrorMessage(err)).toBe("no cause");
  });
});
