import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Capture constructor args + provide a controllable `messages.create` mock
const messagesCreate = vi.fn();
const anthropicCtor = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    public readonly messages = { create: messagesCreate };
    constructor(opts: unknown) {
      anthropicCtor(opts);
    }
  },
}));

describe("Haiku Translator", () => {
  beforeEach(() => {
    messagesCreate.mockReset();
    anthropicCtor.mockReset();
  });

  async function load() {
    return await import("../../src/translator/haiku.js");
  }

  it("translates text via the Anthropic SDK and returns the model's text block", async () => {
    const { createHaikuTranslator } = await load();
    messagesCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Hello world" }],
    });

    const translator = createHaikuTranslator(
      { type: "api_key", apiKey: "sk-test" },
      "claude-haiku-4-5-20251001",
    );
    const result = await translator.translate("こんにちは世界", "auto", "en");

    expect(result).toBe("Hello world");
    expect(messagesCreate).toHaveBeenCalledTimes(1);
    const call = messagesCreate.mock.calls[0][0] as {
      model: string;
      max_tokens: number;
      messages: { role: string; content: string }[];
    };
    expect(call.model).toBe("claude-haiku-4-5-20251001");
    expect(call.max_tokens).toBe(4096);
    expect(call.messages[0].role).toBe("user");
    // The prompt mentions the source-language placeholder and includes the text
    expect(call.messages[0].content).toContain("the source language");
    expect(call.messages[0].content).toContain("to en");
    expect(call.messages[0].content).toContain("こんにちは世界");
  });

  it("uses an explicit source language label when not 'auto'", async () => {
    const { createHaikuTranslator } = await load();
    messagesCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Bonjour" }],
    });

    const translator = createHaikuTranslator(
      { type: "api_key", apiKey: "sk-test" },
      "claude-haiku-4-5-20251001",
    );
    await translator.translate("Hello", "en", "fr");

    const prompt = (messagesCreate.mock.calls[0][0] as {
      messages: { content: string }[];
    }).messages[0].content;
    expect(prompt).toContain("from en to fr");
    expect(prompt).not.toContain("the source language");
  });

  it("throws a descriptive error when the model returns a non-text block", async () => {
    const { createHaikuTranslator } = await load();
    messagesCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "x", name: "y", input: {} }],
    });

    const translator = createHaikuTranslator(
      { type: "api_key", apiKey: "sk-test" },
      "claude-haiku-4-5-20251001",
    );

    await expect(translator.translate("hi", "auto", "en")).rejects.toThrow(
      /Unexpected response type/,
    );
  });

  it("propagates errors from the SDK call", async () => {
    const { createHaikuTranslator } = await load();
    messagesCreate.mockRejectedValueOnce(new Error("rate limited"));

    const translator = createHaikuTranslator(
      { type: "api_key", apiKey: "sk-test" },
      "claude-haiku-4-5-20251001",
    );

    await expect(translator.translate("hi", "auto", "en")).rejects.toThrow("rate limited");
  });

  it("configures the SDK with apiKey for the api_key auth method", async () => {
    const { createHaikuTranslator } = await load();
    createHaikuTranslator(
      { type: "api_key", apiKey: "sk-abc" },
      "claude-haiku-4-5-20251001",
    );

    expect(anthropicCtor).toHaveBeenCalledTimes(1);
    const opts = anthropicCtor.mock.calls[0][0] as {
      apiKey: string | null;
      authToken: string | null;
      baseURL: string;
      defaultHeaders?: Record<string, string>;
    };
    expect(opts.apiKey).toBe("sk-abc");
    expect(opts.authToken).toBeNull();
    expect(opts.baseURL).toBe("https://api.anthropic.com");
    // No oauth beta header for api_key auth
    expect(opts.defaultHeaders).toBeUndefined();
  });

  it("configures the SDK with authToken and oauth beta header for the auth_token auth method", async () => {
    const { createHaikuTranslator } = await load();
    createHaikuTranslator(
      { type: "auth_token", authToken: "oauth-tok" },
      "claude-haiku-4-5-20251001",
    );

    const opts = anthropicCtor.mock.calls[0][0] as {
      apiKey: string | null;
      authToken: string | null;
      baseURL: string;
      defaultHeaders?: Record<string, string>;
    };
    expect(opts.apiKey).toBeNull();
    expect(opts.authToken).toBe("oauth-tok");
    expect(opts.baseURL).toBe("https://api.anthropic.com");
    expect(opts.defaultHeaders).toEqual({ "anthropic-beta": "oauth-2025-04-20" });
  });
});
