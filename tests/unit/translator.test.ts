import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Translator } from "../../src/translator/index.js";

// We test the translator interface contract with a mock,
// since the real Haiku translator requires an API key.
describe("Translator interface", () => {
  function createMockTranslator(): Translator {
    return {
      translate: vi.fn(async (text: string, _from: string, to: string) => {
        if (to === "en") {
          return `[translated to en] ${text}`;
        }
        return text;
      }),
    };
  }

  it("should translate text", async () => {
    const translator = createMockTranslator();
    const result = await translator.translate("こんにちは", "jpn", "en");
    expect(result).toBe("[translated to en] こんにちは");
  });

  it("should call translate with correct parameters", async () => {
    const translator = createMockTranslator();
    await translator.translate("テスト", "auto", "en");
    expect(translator.translate).toHaveBeenCalledWith("テスト", "auto", "en");
  });
});

// Mock google-translate-api-x before importing google-free
const mockTranslate = vi.fn();
vi.mock("google-translate-api-x", () => ({
  default: mockTranslate,
}));

// Suppress logger output during tests
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("Google Free Translator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  // Helper to advance timers for the sleep calls in retry logic
  async function flushRetryTimers(): Promise<void> {
    await vi.advanceTimersByTimeAsync(4000);
  }

  it("should translate successfully on first attempt", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    mockTranslate.mockResolvedValueOnce({ text: "Hello" });

    const translator = createGoogleFreeTranslator();
    const result = await translator.translate("こんにちは", "auto", "en");

    expect(result).toBe("Hello");
    expect(mockTranslate).toHaveBeenCalledTimes(1);
    expect(mockTranslate).toHaveBeenCalledWith("こんにちは", {
      from: "auto",
      to: "en",
      tld: "com",
      forceBatch: false,
    });
  });

  it("should retry with TLD rotation on failure", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    mockTranslate
      .mockRejectedValueOnce(new Error("Partial Translation Request Fail"))
      .mockResolvedValueOnce({ text: "Hello" });

    const translator = createGoogleFreeTranslator();
    const promise = translator.translate("こんにちは", "auto", "en");

    await vi.advanceTimersByTimeAsync(600);

    const result = await promise;

    expect(result).toBe("Hello");
    expect(mockTranslate).toHaveBeenCalledTimes(2);
    expect(mockTranslate.mock.calls[0][1]).toEqual(
      expect.objectContaining({ tld: "com" }),
    );
    expect(mockTranslate.mock.calls[1][1]).toEqual(
      expect.objectContaining({ tld: "co.jp" }),
    );
  });

  it("should return original text after all retries exhausted", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    mockTranslate
      .mockRejectedValueOnce(new Error("Error 1"))
      .mockRejectedValueOnce(new Error("Error 2"))
      .mockRejectedValueOnce(new Error("Error 3"));

    const translator = createGoogleFreeTranslator();
    const promise = translator.translate("こんにちは", "auto", "en");

    await flushRetryTimers();

    const result = await promise;

    expect(result).toBe("こんにちは");
    expect(mockTranslate).toHaveBeenCalledTimes(3);
  });

  it("should use exponential backoff between retries", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    mockTranslate
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce({ text: "OK" });

    const translator = createGoogleFreeTranslator();
    const promise = translator.translate("test", "auto", "en");

    expect(mockTranslate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(mockTranslate).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(mockTranslate).toHaveBeenCalledTimes(3);

    const result = await promise;
    expect(result).toBe("OK");
  });

  it("should cycle through all TLDs", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    mockTranslate
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"));

    const translator = createGoogleFreeTranslator();
    const promise = translator.translate("test", "auto", "en");

    await flushRetryTimers();
    await promise;

    expect(mockTranslate.mock.calls[0][1].tld).toBe("com");
    expect(mockTranslate.mock.calls[1][1].tld).toBe("co.jp");
    expect(mockTranslate.mock.calls[2][1].tld).toBe("co.uk");
  });

  it("should handle non-Error thrown values", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    mockTranslate
      .mockRejectedValueOnce("string error")
      .mockResolvedValueOnce({ text: "OK" });

    const translator = createGoogleFreeTranslator();
    const promise = translator.translate("test", "auto", "en");

    await vi.advanceTimersByTimeAsync(600);

    const result = await promise;
    expect(result).toBe("OK");
  });

  it("should split large text into chunks", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    // Create text larger than 4500 chars with paragraph breaks
    const paragraph = "This is a paragraph of text. ".repeat(100); // ~2900 chars
    const largeText = `${paragraph}\n\n${paragraph}\n\n${paragraph}`; // ~8700+ chars

    mockTranslate.mockImplementation(async (text: string) => ({
      text: `[translated] ${text.slice(0, 20)}...`,
    }));

    const translator = createGoogleFreeTranslator();
    const result = await translator.translate(largeText, "auto", "en");

    // Should have been called multiple times (one per chunk)
    expect(mockTranslate.mock.calls.length).toBeGreaterThan(1);
    // Result should contain joined translations
    expect(result).toContain("[translated]");
  });

  it("should not split small text", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    mockTranslate.mockResolvedValueOnce({ text: "Hello world" });

    const translator = createGoogleFreeTranslator();
    await translator.translate("小さいテキスト", "auto", "en");

    expect(mockTranslate).toHaveBeenCalledTimes(1);
  });

  it("should split at single newline when no paragraph boundary", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    // Create text with single newlines but no double newlines, exceeding 4500 chars
    const line = "This is a line of text that fills up space for testing. ";
    const longLine = line.repeat(40); // ~2200 chars per segment
    const text = `${longLine}\n${longLine}\n${longLine}`; // ~6600 chars, no \n\n

    mockTranslate.mockImplementation(async (t: string) => ({
      text: `[t] ${t.slice(0, 10)}`,
    }));

    const translator = createGoogleFreeTranslator();
    await translator.translate(text, "auto", "en");

    // Should split into multiple chunks at \n boundaries
    expect(mockTranslate.mock.calls.length).toBeGreaterThan(1);
  });

  it("should split at sentence boundary when no newlines available", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    // Create text with sentences but no newlines
    const sentence = "This is a test sentence with moderate length for chunking. ";
    const text = sentence.repeat(100); // ~5800 chars, no newlines

    mockTranslate.mockImplementation(async (t: string) => ({
      text: `[t] ${t.slice(0, 10)}`,
    }));

    const translator = createGoogleFreeTranslator();
    await translator.translate(text, "auto", "en");

    expect(mockTranslate.mock.calls.length).toBeGreaterThan(1);
  });

  it("should hard split when no natural boundaries exist", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    // Create text with no newlines, no periods, no spaces — just a wall of characters
    const text = "あ".repeat(5000); // 5000 chars, no natural break points

    mockTranslate.mockImplementation(async (t: string) => ({
      text: `[t] ${t.length}`,
    }));

    const translator = createGoogleFreeTranslator();
    await translator.translate(text, "auto", "en");

    // Should hard-split at MAX_CHUNK_CHARS (4500)
    expect(mockTranslate.mock.calls.length).toBe(2);
    expect(mockTranslate.mock.calls[0][0].length).toBe(4500);
  });

  it("should pass specific from language instead of auto", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    mockTranslate.mockResolvedValueOnce({ text: "Hello" });

    const translator = createGoogleFreeTranslator();
    await translator.translate("こんにちは", "ja", "en");

    expect(mockTranslate).toHaveBeenCalledWith("こんにちは", {
      from: "ja",
      to: "en",
      tld: "com",
      forceBatch: false,
    });
  });

  it("should handle Error with cause in error message", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    const errorWithCause = new Error("Network error");
    errorWithCause.cause = "ECONNREFUSED";
    mockTranslate
      .mockRejectedValueOnce(errorWithCause)
      .mockResolvedValueOnce({ text: "OK" });

    const translator = createGoogleFreeTranslator();
    const promise = translator.translate("test", "auto", "en");

    await vi.advanceTimersByTimeAsync(600);

    const result = await promise;
    expect(result).toBe("OK");
  });
});

// Mock Anthropic SDK before importing haiku
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

describe("Haiku Translator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should translate text using Claude API with api_key auth", async () => {
    const { createHaikuTranslator } = await import(
      "../../src/translator/haiku.js"
    );

    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Hello" }],
    });

    const translator = createHaikuTranslator(
      { type: "api_key", apiKey: "test-key" },
      "claude-haiku-4-5-20251001",
    );
    const result = await translator.translate("こんにちは", "auto", "en");

    expect(result).toBe("Hello");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
      }),
    );
  });

  it("should translate with specific from language", async () => {
    const { createHaikuTranslator } = await import(
      "../../src/translator/haiku.js"
    );

    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Hello" }],
    });

    const translator = createHaikuTranslator(
      { type: "api_key", apiKey: "test-key" },
      "claude-haiku-4-5-20251001",
    );
    await translator.translate("こんにちは", "ja", "en");

    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content).toContain("from ja to en");
  });

  it("should use auto label when from is auto", async () => {
    const { createHaikuTranslator } = await import(
      "../../src/translator/haiku.js"
    );

    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Hello" }],
    });

    const translator = createHaikuTranslator(
      { type: "api_key", apiKey: "test-key" },
      "claude-haiku-4-5-20251001",
    );
    await translator.translate("こんにちは", "auto", "en");

    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content).toContain("the source language");
  });

  it("should throw on unexpected response type", async () => {
    const { createHaikuTranslator } = await import(
      "../../src/translator/haiku.js"
    );

    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", id: "123", name: "test", input: {} }],
    });

    const translator = createHaikuTranslator(
      { type: "api_key", apiKey: "test-key" },
      "claude-haiku-4-5-20251001",
    );

    await expect(translator.translate("test", "auto", "en")).rejects.toThrow(
      "Unexpected response type from Claude API",
    );
  });

  it("should work with auth_token auth method", async () => {
    const { createHaikuTranslator } = await import(
      "../../src/translator/haiku.js"
    );
    const Anthropic = (await import("@anthropic-ai/sdk")).default;

    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Hello" }],
    });

    createHaikuTranslator(
      { type: "auth_token", authToken: "oauth-token-123" },
      "claude-haiku-4-5-20251001",
    );

    // Verify Anthropic was constructed with auth token config
    expect(Anthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        authToken: "oauth-token-123",
        apiKey: null,
        baseURL: "https://api.anthropic.com",
        defaultHeaders: { "anthropic-beta": "oauth-2025-04-20" },
      }),
    );
  });
});
