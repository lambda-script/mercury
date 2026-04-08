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

  it("should split at single newline when no paragraph break is present", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    // Build text >4500 chars with only single \n separators (no \n\n)
    const line = "これは日本語の単一改行のテストの行です。".repeat(20); // ~480 chars
    const largeText = Array.from({ length: 20 }, () => line).join("\n");
    expect(largeText.length).toBeGreaterThan(4500);
    expect(largeText.includes("\n\n")).toBe(false);

    mockTranslate.mockImplementation(async (chunk: string) => ({
      text: `[T:${chunk.length}]`,
    }));

    const translator = createGoogleFreeTranslator();
    const result = await translator.translate(largeText, "auto", "en");

    // Multiple chunks expected
    expect(mockTranslate.mock.calls.length).toBeGreaterThan(1);
    // Each chunk should be <= 4500 chars
    for (const call of mockTranslate.mock.calls) {
      expect((call[0] as string).length).toBeLessThanOrEqual(4500);
    }
    expect(result).toContain("[T:");
  });

  it("should split at sentence boundary when no newlines are present", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    // No newlines anywhere; only ". " sentence boundaries
    const sentence = "This is a sentence with no newlines anywhere in it. ";
    const largeText = sentence.repeat(120); // ~6240 chars, single line
    expect(largeText.length).toBeGreaterThan(4500);
    expect(largeText.includes("\n")).toBe(false);

    mockTranslate.mockImplementation(async (chunk: string) => ({
      text: `[len:${chunk.length}]`,
    }));

    const translator = createGoogleFreeTranslator();
    await translator.translate(largeText, "auto", "en");

    expect(mockTranslate.mock.calls.length).toBeGreaterThan(1);
    // First chunk must end at a sentence boundary (a period)
    const firstChunk = mockTranslate.mock.calls[0][0] as string;
    expect(firstChunk.endsWith(".")).toBe(true);
    expect(firstChunk.length).toBeLessThanOrEqual(4500);
  });

  it("should hard-split when no boundary characters are present at all", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    // No newlines, no ". " — one massive contiguous string
    const largeText = "x".repeat(10_000);
    mockTranslate.mockImplementation(async (chunk: string) => ({
      text: `[len:${chunk.length}]`,
    }));

    const translator = createGoogleFreeTranslator();
    await translator.translate(largeText, "auto", "en");

    // Should have at least 3 chunks (10000 / 4500 = 2.2 → 3)
    expect(mockTranslate.mock.calls.length).toBeGreaterThanOrEqual(3);
    // First chunk should be exactly the hard-split max
    expect((mockTranslate.mock.calls[0][0] as string).length).toBe(4500);
  });

  it("should pass through an explicit (non-auto) source language", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    mockTranslate.mockResolvedValueOnce({ text: "Hello" });

    const translator = createGoogleFreeTranslator();
    await translator.translate("こんにちは", "ja", "en");

    expect(mockTranslate).toHaveBeenCalledWith(
      "こんにちは",
      expect.objectContaining({ from: "ja", to: "en" }),
    );
  });

  it("should propagate failure of one chunk while still translating others", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    const part = "x".repeat(4500);
    const text = part + "\n\n" + part; // 2 chunks via paragraph split

    // First chunk: fails 3 times (returns original)
    // Second chunk: succeeds first try
    mockTranslate
      .mockRejectedValueOnce(new Error("fail-1"))
      .mockRejectedValueOnce(new Error("fail-2"))
      .mockRejectedValueOnce(new Error("fail-3"))
      .mockResolvedValueOnce({ text: "second-translated" });

    const translator = createGoogleFreeTranslator();
    const promise = translator.translate(text, "auto", "en");

    // Drain the retry sleeps for the first chunk
    await flushRetryTimers();

    const result = await promise;

    // First chunk falls back to original; second is translated; joined with \n
    expect(result).toBe(part + "\n" + "second-translated");
  });

  it("should handle Error with cause in retry log path", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    const cause = new Error("underlying socket error");
    const err = new Error("translation failed", { cause });

    mockTranslate.mockRejectedValueOnce(err).mockResolvedValueOnce({ text: "OK" });

    const translator = createGoogleFreeTranslator();
    const promise = translator.translate("test", "auto", "en");
    await vi.advanceTimersByTimeAsync(600);
    const result = await promise;

    expect(result).toBe("OK");
  });
});
