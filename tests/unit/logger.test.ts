import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { unlinkSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("logger", () => {
  const originalEnv = { ...process.env };
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
    process.env = { ...originalEnv };
    // Clear module cache to get fresh imports
    vi.resetModules();
  });

  it("should log info messages by default", async () => {
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

  it("should not log debug messages when log level is info", async () => {
    process.env.MERCURY_LOG_LEVEL = "info";
    const { logger } = await import("../../src/utils/logger.js");
    logger.debug("test debug");
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("should log debug messages when log level is debug", async () => {
    process.env.MERCURY_LOG_LEVEL = "debug";
    const { logger } = await import("../../src/utils/logger.js");
    logger.debug("test debug");
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("[DEBUG] test debug"));
  });

  it("should respect warn log level threshold", async () => {
    process.env.MERCURY_LOG_LEVEL = "warn";
    const { logger } = await import("../../src/utils/logger.js");

    logger.info("should not appear");
    expect(writeSpy).not.toHaveBeenCalled();

    logger.warn("should appear");
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("[WARN] should appear"));
  });

  it("should respect error log level threshold", async () => {
    process.env.MERCURY_LOG_LEVEL = "error";
    const { logger } = await import("../../src/utils/logger.js");

    logger.warn("should not appear");
    logger.info("should not appear");
    expect(writeSpy).not.toHaveBeenCalled();

    logger.error("should appear");
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("[ERROR] should appear"));
  });

  it("should write to file when MERCURY_LOG_FILE is set", async () => {
    const logFile = join(process.cwd(), "test-log.txt");
    process.env.MERCURY_LOG_FILE = logFile;

    // Clean up any existing test log file
    if (existsSync(logFile)) {
      unlinkSync(logFile);
    }

    const { logger } = await import("../../src/utils/logger.js");
    logger.info("file log test");

    // Verify file was created and contains the log
    expect(existsSync(logFile)).toBe(true);
    const content = readFileSync(logFile, "utf-8");
    expect(content).toContain("[INFO] file log test");

    // Clean up
    unlinkSync(logFile);
  });

  it("should fall back to stderr when file write fails", async () => {
    // Use an invalid path that will fail
    process.env.MERCURY_LOG_FILE = "/invalid/path/that/does/not/exist/test.log";

    const { logger } = await import("../../src/utils/logger.js");
    logger.info("fallback test");

    // Should have fallen back to stderr
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("[INFO] fallback test"));
  });

  it("should extract message from Error objects in errorMessage", async () => {
    const { errorMessage } = await import("../../src/utils/logger.js");
    expect(errorMessage(new Error("test error"))).toBe("test error");
  });

  it("should convert non-Error values to string in errorMessage", async () => {
    const { errorMessage } = await import("../../src/utils/logger.js");
    expect(errorMessage("string error")).toBe("string error");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage(undefined)).toBe("undefined");
    expect(errorMessage({ code: "EPIPE" })).toBe("[object Object]");
  });
});
