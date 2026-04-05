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

  it("should split at sentence boundary when no paragraph/newline break exists", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    // Create text with only sentence boundaries (no newlines), > 4500 chars
    const sentence = "This is a test sentence with some content. ";
    const text = sentence.repeat(120); // ~5280 chars

    mockTranslate.mockImplementation(async (t: string) => ({
      text: t,
    }));

    const translator = createGoogleFreeTranslator();
    await translator.translate(text, "auto", "en");

    expect(mockTranslate.mock.calls.length).toBe(2);
    // First chunk should end at a sentence boundary (". ")
    expect(mockTranslate.mock.calls[0][0].endsWith(".")).toBe(true);
  });

  it("should hard split when no boundary exists at all", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    // Continuous text with no newlines, periods, or spaces at split points
    const text = "abcdefghij".repeat(900); // 9000 chars, no breaks

    mockTranslate.mockImplementation(async (t: string) => ({
      text: t,
    }));

    const translator = createGoogleFreeTranslator();
    await translator.translate(text, "auto", "en");

    expect(mockTranslate.mock.calls.length).toBe(2);
    // First chunk should be exactly 4500 chars (hard split at MAX_CHUNK_CHARS)
    expect(mockTranslate.mock.calls[0][0].length).toBe(4500);
  });

  it("should split at single newline when no paragraph boundary exists", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    // Lines with single newlines, no double newlines, > 4500 chars
    const line = "A".repeat(90) + "\n";
    const text = line.repeat(55); // ~5005 chars

    mockTranslate.mockImplementation(async (t: string) => ({
      text: t,
    }));

    const translator = createGoogleFreeTranslator();
    await translator.translate(text, "auto", "en");

    expect(mockTranslate.mock.calls.length).toBe(2);
    // First chunk should be shorter than MAX_CHUNK_CHARS and split at a newline
    expect(mockTranslate.mock.calls[0][0].length).toBeLessThanOrEqual(4500);
  });

  it("should handle Error with cause in error message", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    const err = new Error("outer");
    err.cause = "inner cause";
    mockTranslate
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ text: "OK" });

    const translator = createGoogleFreeTranslator();
    const promise = translator.translate("test", "auto", "en");

    await vi.advanceTimersByTimeAsync(600);

    const result = await promise;
    expect(result).toBe("OK");
  });

  it("should pass through specific from language instead of auto", async () => {
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
});
