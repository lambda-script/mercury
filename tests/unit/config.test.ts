import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-api-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should load default config", () => {
    const config = loadConfig();
    expect(config.backend).toBe("haiku");
    expect(config.sourceLang).toBe("auto");
    expect(config.targetLang).toBe("en");
    expect(config.anthropicApiKey).toBe("test-api-key");
    expect(config.proxyPort).toBe(3100);
    expect(config.upstreamUrl).toBe("https://api.anthropic.com");
    expect(config.minDetectLength).toBe(20);
  });

  it("should throw if ANTHROPIC_API_KEY is missing", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => loadConfig()).toThrow("ANTHROPIC_API_KEY environment variable is required");
  });

  it("should use custom environment variables", () => {
    process.env.MERCURY_BACKEND = "deepl";
    process.env.MERCURY_SOURCE_LANG = "ja";
    process.env.MERCURY_TARGET_LANG = "fr";
    process.env.MERCURY_PORT = "8080";
    process.env.MERCURY_UPSTREAM_URL = "http://custom.api.com";
    process.env.MERCURY_MIN_DETECT_LENGTH = "50";

    const config = loadConfig();
    expect(config.backend).toBe("deepl");
    expect(config.sourceLang).toBe("ja");
    expect(config.targetLang).toBe("fr");
    expect(config.proxyPort).toBe(8080);
    expect(config.upstreamUrl).toBe("http://custom.api.com");
    expect(config.minDetectLength).toBe(50);
  });
});
