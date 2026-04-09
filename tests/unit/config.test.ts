import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Default: no auth, google-free backend (no keys needed)
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.MERCURY_BACKEND;
    delete process.env.MERCURY_HAIKU_MODEL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should load default config without any API keys (google-free)", () => {
    const config = loadConfig();
    expect(config.backend).toBe("google-free");
    expect(config.sourceLang).toBe("auto");
    expect(config.targetLang).toBe("en");
    expect(config.auth).toBeNull();
    expect(config.minDetectLength).toBe(20);
    expect(config.haikuModel).toBe("claude-haiku-4-5-20251001");
  });

  it("should use custom haiku model from MERCURY_HAIKU_MODEL", () => {
    process.env.MERCURY_HAIKU_MODEL = "claude-haiku-4-5-custom";

    const config = loadConfig();
    expect(config.haikuModel).toBe("claude-haiku-4-5-custom");
  });

  it("should use API key auth when ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "test-api-key";

    const config = loadConfig();
    expect(config.auth).toEqual({ type: "api_key", apiKey: "test-api-key" });
  });

  it("should use auth token when ANTHROPIC_AUTH_TOKEN is set", () => {
    process.env.ANTHROPIC_AUTH_TOKEN = "test-auth-token";

    const config = loadConfig();
    expect(config.auth).toEqual({ type: "auth_token", authToken: "test-auth-token" });
  });

  it("should prefer auth token over API key when both are set", () => {
    process.env.ANTHROPIC_API_KEY = "test-api-key";
    process.env.ANTHROPIC_AUTH_TOKEN = "test-auth-token";

    const config = loadConfig();
    expect(config.auth).toEqual({ type: "auth_token", authToken: "test-auth-token" });
  });

  it("should throw if haiku backend is selected without auth", () => {
    process.env.MERCURY_BACKEND = "haiku";

    expect(() => loadConfig()).toThrow(
      "ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is required when using the 'haiku' backend",
    );
  });

  it("should allow haiku backend with API key", () => {
    process.env.MERCURY_BACKEND = "haiku";
    process.env.ANTHROPIC_API_KEY = "test-api-key";

    const config = loadConfig();
    expect(config.backend).toBe("haiku");
    expect(config.auth).toEqual({ type: "api_key", apiKey: "test-api-key" });
  });

  it("should throw if MERCURY_MIN_DETECT_LENGTH is not a positive integer", () => {
    process.env.MERCURY_MIN_DETECT_LENGTH = "not-a-number";

    expect(() => loadConfig()).toThrow(
      "MERCURY_MIN_DETECT_LENGTH must be a positive integer, got 'not-a-number'",
    );
  });

  it("should throw if MERCURY_MIN_DETECT_LENGTH is zero", () => {
    process.env.MERCURY_MIN_DETECT_LENGTH = "0";

    expect(() => loadConfig()).toThrow(
      "MERCURY_MIN_DETECT_LENGTH must be a positive integer, got '0'",
    );
  });

  it("should use custom environment variables", () => {
    process.env.MERCURY_BACKEND = "deepl";
    process.env.MERCURY_SOURCE_LANG = "ja";
    process.env.MERCURY_TARGET_LANG = "fr";
    process.env.MERCURY_MIN_DETECT_LENGTH = "50";

    const config = loadConfig();
    expect(config.backend).toBe("deepl");
    expect(config.sourceLang).toBe("ja");
    expect(config.targetLang).toBe("fr");
    expect(config.minDetectLength).toBe(50);
  });
});
