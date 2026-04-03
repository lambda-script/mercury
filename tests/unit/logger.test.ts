import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("logger", () => {
  const originalEnv = { ...process.env };
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
    process.env = { ...originalEnv };
  });

  it("should log info messages by default", async () => {
    // Re-import to get fresh module with default env
    const { logger } = await import("../../src/utils/logger.js");
    logger.info("test info");
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("[INFO] test info"));
  });

  it("should log error messages", async () => {
    const { logger } = await import("../../src/utils/logger.js");
    logger.error("test error");
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("[ERROR] test error"));
  });

  it("should log warn messages", async () => {
    const { logger } = await import("../../src/utils/logger.js");
    logger.warn("test warn");
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("[WARN] test warn"));
  });

  it("should include timestamp in log messages", async () => {
    const { logger } = await import("../../src/utils/logger.js");
    logger.info("timestamp test");
    const call = writeSpy.mock.calls[0]?.[0] as string;
    // Should match ISO timestamp pattern
    expect(call).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
