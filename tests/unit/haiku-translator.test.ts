import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthMethod } from "../../src/config.js";

// Mock the Anthropic SDK before importing the haiku translator
const mockCreate = vi.fn();
const mockConstructor = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor(opts: unknown) {
      mockConstructor(opts);
    }
    messages = { create: mockCreate };
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("Haiku translator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should construct Anthropic client with API key auth", async () => {
    const { createHaikuTranslator } = await import(
      "../../src/translator/haiku.js"
    );
    const auth: AuthMethod = { type: "api_key", apiKey: "sk-test-key" };
    createHaikuTranslator(auth, "claude-haiku-4-5-20251001");

    expect(mockConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-test-key",
        authToken: null,
        baseURL: "https://api.anthropic.com",
      }),
    );
  });

  it("should construct Anthropic client with OAuth token and beta header", async () => {
    const { createHaikuTranslator } = await import(
      "../../src/translator/haiku.js"
    );
    const auth: AuthMethod = { type: "auth_token", authToken: "oat-test-token" };
    createHaikuTranslator(auth, "claude-haiku-4-5-20251001");

    expect(mockConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: null,
        authToken: "oat-test-token",
        defaultHeaders: { "anthropic-beta": "oauth-2025-04-20" },
      }),
    );
  });

  it("should translate text and return content", async () => {
    const { createHaikuTranslator } = await import(
      "../../src/translator/haiku.js"
    );
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Hello world" }],
    });

    const translator = createHaikuTranslator(
      { type: "api_key", apiKey: "sk-test" },
      "claude-haiku-4-5-20251001",
    );
    const result = await translator.translate("こんにちは世界", "auto", "en");

    expect(result).toBe("Hello world");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        messages: [
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("こんにちは世界"),
          }),
        ],
      }),
    );
  });

  it("should use 'the source language' label when from='auto'", async () => {
    const { createHaikuTranslator } = await import(
      "../../src/translator/haiku.js"
    );
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "out" }],
    });

    const translator = createHaikuTranslator(
      { type: "api_key", apiKey: "sk-test" },
      "claude-haiku-4-5-20251001",
    );
    await translator.translate("text", "auto", "en");

    const prompt = (mockCreate.mock.calls[0][0] as { messages: { content: string }[] })
      .messages[0].content;
    expect(prompt).toContain("the source language");
    expect(prompt).toContain("to en");
  });

  it("should use explicit from-lang label when not 'auto'", async () => {
    const { createHaikuTranslator } = await import(
      "../../src/translator/haiku.js"
    );
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "out" }],
    });

    const translator = createHaikuTranslator(
      { type: "api_key", apiKey: "sk-test" },
      "claude-haiku-4-5-20251001",
    );
    await translator.translate("text", "jpn", "en");

    const prompt = (mockCreate.mock.calls[0][0] as { messages: { content: string }[] })
      .messages[0].content;
    expect(prompt).toContain("from jpn");
  });

  it("should throw a descriptive error if response block is not text", async () => {
    const { createHaikuTranslator } = await import(
      "../../src/translator/haiku.js"
    );
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "x", name: "y", input: {} }],
    });

    const translator = createHaikuTranslator(
      { type: "api_key", apiKey: "sk-test" },
      "claude-haiku-4-5-20251001",
    );

    await expect(translator.translate("text", "auto", "en")).rejects.toThrow(
      /Unexpected response type/,
    );
  });

  it("should propagate API errors from the SDK", async () => {
    const { createHaikuTranslator } = await import(
      "../../src/translator/haiku.js"
    );
    mockCreate.mockRejectedValueOnce(new Error("rate limited"));

    const translator = createHaikuTranslator(
      { type: "api_key", apiKey: "sk-test" },
      "claude-haiku-4-5-20251001",
    );

    await expect(translator.translate("text", "auto", "en")).rejects.toThrow(
      "rate limited",
    );
  });
});
