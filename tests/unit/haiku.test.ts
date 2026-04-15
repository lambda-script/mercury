import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the constructor args and provide a controllable .messages.create mock
const mockCreate = vi.fn();
const mockConstructor = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    public messages: { create: typeof mockCreate };
    constructor(options: unknown) {
      mockConstructor(options);
      this.messages = { create: mockCreate };
    }
  }
  return { default: MockAnthropic };
});

// Suppress logger output during tests
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("Haiku Translator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should construct the Anthropic client with apiKey when auth is api_key", async () => {
    const { createHaikuTranslator } = await import(
      "../../src/translator/haiku.js"
    );

    createHaikuTranslator(
      { type: "api_key", apiKey: "sk-test" },
      "claude-haiku-4-5-20251001",
    );

    expect(mockConstructor).toHaveBeenCalledOnce();
    const opts = mockConstructor.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.apiKey).toBe("sk-test");
    expect(opts.authToken).toBeNull();
    // Direct connection bypassing any proxy to avoid loops
    expect(opts.baseURL).toBe("https://api.anthropic.com");
    // No oauth-beta header for API key auth
    expect(opts.defaultHeaders).toBeUndefined();
  });

  it("should construct the Anthropic client with auth_token and oauth-beta header", async () => {
    const { createHaikuTranslator } = await import(
      "../../src/translator/haiku.js"
    );

    createHaikuTranslator(
      { type: "auth_token", authToken: "oauth-token-xyz" },
      "claude-haiku-4-5-20251001",
    );

    const opts = mockConstructor.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.apiKey).toBeNull();
    expect(opts.authToken).toBe("oauth-token-xyz");
    expect(opts.defaultHeaders).toEqual({ "anthropic-beta": "oauth-2025-04-20" });
  });

  it("should translate text and return the model's text output", async () => {
    const { createHaikuTranslator } = await import(
      "../../src/translator/haiku.js"
    );
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Hello, world." }],
    });

    const translator = createHaikuTranslator(
      { type: "api_key", apiKey: "sk-test" },
      "claude-haiku-4-5-20251001",
    );

    const result = await translator.translate("こんにちは、世界。", "auto", "en");
    expect(result).toBe("Hello, world.");

    expect(mockCreate).toHaveBeenCalledOnce();
    const args = mockCreate.mock.calls[0][0] as {
      model: string;
      max_tokens: number;
      messages: { role: string; content: string }[];
    };
    expect(args.model).toBe("claude-haiku-4-5-20251001");
    expect(args.max_tokens).toBe(4096);
    expect(args.messages).toHaveLength(1);
    expect(args.messages[0].role).toBe("user");
    // Prompt should reference the source language label and target language
    expect(args.messages[0].content).toContain("the source language");
    expect(args.messages[0].content).toContain("to en");
    expect(args.messages[0].content).toContain("こんにちは、世界。");
  });

  it("should pass an explicit source language label through into the prompt", async () => {
    const { createHaikuTranslator } = await import(
      "../../src/translator/haiku.js"
    );
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Hi" }],
    });

    const translator = createHaikuTranslator(
      { type: "api_key", apiKey: "sk-test" },
      "claude-haiku-4-5-20251001",
    );

    await translator.translate("Bonjour", "fr", "en");

    const args = mockCreate.mock.calls[0][0] as {
      messages: { content: string }[];
    };
    expect(args.messages[0].content).toContain("from fr to en");
    expect(args.messages[0].content).not.toContain("the source language");
  });

  it("should throw a descriptive error when the API returns a non-text block", async () => {
    const { createHaikuTranslator } = await import(
      "../../src/translator/haiku.js"
    );
    // Some SDK versions may return tool_use, image, etc.
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "x", name: "translate", input: {} }],
    });

    const translator = createHaikuTranslator(
      { type: "api_key", apiKey: "sk-test" },
      "claude-haiku-4-5-20251001",
    );

    await expect(translator.translate("テスト", "auto", "en")).rejects.toThrow(
      /got 'tool_use'/,
    );
  });

  it("should propagate errors thrown by the Anthropic SDK", async () => {
    const { createHaikuTranslator } = await import(
      "../../src/translator/haiku.js"
    );
    mockCreate.mockRejectedValueOnce(new Error("rate_limit_error"));

    const translator = createHaikuTranslator(
      { type: "api_key", apiKey: "sk-test" },
      "claude-haiku-4-5-20251001",
    );

    await expect(translator.translate("テスト", "auto", "en")).rejects.toThrow(
      "rate_limit_error",
    );
  });

  it("should respect the model parameter passed at construction time", async () => {
    const { createHaikuTranslator } = await import(
      "../../src/translator/haiku.js"
    );
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "OK" }],
    });

    const translator = createHaikuTranslator(
      { type: "api_key", apiKey: "sk-test" },
      "custom-model-id",
    );

    await translator.translate("テスト", "auto", "en");
    const args = mockCreate.mock.calls[0][0] as { model: string };
    expect(args.model).toBe("custom-model-id");
  });

  it("should include the text to translate in the prompt", async () => {
    const { createHaikuTranslator } = await import(
      "../../src/translator/haiku.js"
    );
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Translated" }],
    });

    const translator = createHaikuTranslator(
      { type: "api_key", apiKey: "sk-test" },
      "claude-haiku-4-5-20251001",
    );

    const longText = "これは非常に長い日本語のテキストで、APIを通じて翻訳される必要があります。";
    await translator.translate(longText, "auto", "en");

    const args = mockCreate.mock.calls[0][0] as {
      messages: { content: string }[];
    };
    expect(args.messages[0].content).toContain(longText);
  });

  it("should throw descriptive error when content array is empty", async () => {
    const { createHaikuTranslator } = await import(
      "../../src/translator/haiku.js"
    );
    // Response with empty content array — accessing [0] gives undefined
    mockCreate.mockResolvedValueOnce({
      content: [],
    });

    const translator = createHaikuTranslator(
      { type: "api_key", apiKey: "sk-test" },
      "claude-haiku-4-5-20251001",
    );

    // Accessing .type on undefined should throw
    await expect(translator.translate("テスト", "auto", "en")).rejects.toThrow();
  });
});
