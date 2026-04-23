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

  it("should preserve paragraph breaks (\\n\\n) across chunk boundaries", async () => {
    // Passthrough mock so we can verify lossless reassembly.
    mockTranslate.mockImplementation(async (text: string) => ({ text }));

    const para = "x".repeat(2000);
    const input = `${para}\n\n${para}\n\n${para}`;

    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    const result = await createGoogleFreeTranslator().translate(input, "auto", "en");

    expect(result).toBe(input);
    expect(mockTranslate.mock.calls.length).toBeGreaterThan(1);
  });

  it("should preserve single-newline boundaries across chunks", async () => {
    mockTranslate.mockImplementation(async (text: string) => ({ text }));

    // Single \n separators only — exercises the second split branch.
    const line = "x".repeat(2000);
    const input = `${line}\n${line}\n${line}`;

    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    const result = await createGoogleFreeTranslator().translate(input, "auto", "en");

    expect(result).toBe(input);
  });

  it("should preserve sentence-boundary spaces across chunks", async () => {
    mockTranslate.mockImplementation(async (text: string) => ({ text }));

    // ". " separators only (no newlines) — exercises the third split branch.
    const sentence = "x".repeat(2000) + ".";
    const input = `${sentence} ${sentence} ${sentence}`;

    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    const result = await createGoogleFreeTranslator().translate(input, "auto", "en");

    expect(result).toBe(input);
  });

  it("should hard-split text with no natural boundaries without losing data", async () => {
    mockTranslate.mockImplementation(async (text: string) => ({ text }));

    // No newlines, no ". " — forces the hard-split fallback path.
    const input = "x".repeat(5000);

    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    const result = await createGoogleFreeTranslator().translate(input, "auto", "en");

    expect(result).toBe(input);
    expect(mockTranslate.mock.calls.length).toBeGreaterThan(1);
  });

  it("should not split a UTF-16 surrogate pair on hard-split", async () => {
    mockTranslate.mockImplementation(async (text: string) => ({ text }));

    // 😀 (U+1F600) is encoded as a surrogate pair (high 0xD83D, low 0xDE00).
    // Place it at indices 4499/4500 so a naive hard-split at MAX_CHUNK_CHARS
    // (4500) would land between the high and low surrogates and corrupt it.
    const input = "x".repeat(4499) + "\uD83D\uDE00" + "x".repeat(700);

    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    const result = await createGoogleFreeTranslator().translate(input, "auto", "en");

    expect(result).toBe(input);

    // Sanity check: no chunk handed to the translator may start or end on a
    // lone surrogate.
    for (const call of mockTranslate.mock.calls) {
      const chunk = call[0] as string;
      if (chunk.length === 0) continue;
      const first = chunk.charCodeAt(0);
      const last = chunk.charCodeAt(chunk.length - 1);
      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false); // lone low at start
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);   // lone high at end
    }
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

  it("should time out a hung attempt and fall back to original text", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    // All attempts hang forever — simulates a stalled HTTPS connection.
    // Without the per-attempt timeout this would block the proxy queue
    // indefinitely; with it, each attempt rejects after 15s and we fall
    // back to the original text after exhausting retries.
    mockTranslate.mockImplementation(() => new Promise(() => {}));

    const translator = createGoogleFreeTranslator();
    const promise = translator.translate("テスト", "auto", "en");

    // 3 attempts × 15s timeout + 500ms + 1000ms backoff
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(15_000);

    const result = await promise;

    expect(result).toBe("テスト");
    expect(mockTranslate).toHaveBeenCalledTimes(3);
  });

  it("should split at single newline when no paragraph break exists", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    // Two lines joined by single \n, totaling > 4500 chars, no \n\n boundary
    const line = "a".repeat(3000);
    const text = `${line}\n${line}`;

    mockTranslate.mockImplementation(async (chunk: string) => ({
      text: `T(${chunk.length})`,
    }));

    const translator = createGoogleFreeTranslator();
    const result = await translator.translate(text, "auto", "en");

    expect(mockTranslate.mock.calls.length).toBe(2);
    // Joined output preserves both chunks
    expect(result).toContain("T(3000)");
  });

  it("should split at sentence boundary when no newline exists", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    // No newlines anywhere; only ". " sentence boundaries, > 4500 chars
    const sentence = "abc def ghi jkl mno pqr stu vwx yz. ".repeat(150); // ~5400 chars

    mockTranslate.mockImplementation(async (chunk: string) => ({
      text: `T(${chunk.length})`,
    }));

    const translator = createGoogleFreeTranslator();
    await translator.translate(sentence, "auto", "en");

    // Must split into at least 2 chunks
    expect(mockTranslate.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Each chunk's last non-space character should be a period (sentence boundary)
    for (const call of mockTranslate.mock.calls.slice(0, -1)) {
      const chunk = call[0] as string;
      expect(chunk.trimEnd().endsWith(".")).toBe(true);
    }
  });

  it("should hard-split when no boundary exists", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    // 6000 contiguous characters, no whitespace, no period, no newline
    const blob = "x".repeat(6000);

    mockTranslate.mockImplementation(async (chunk: string) => ({
      text: `T(${chunk.length})`,
    }));

    const translator = createGoogleFreeTranslator();
    await translator.translate(blob, "auto", "en");

    // Hard split at MAX_CHUNK_CHARS (4500) → 2 chunks: 4500 + 1500
    expect(mockTranslate.mock.calls.length).toBe(2);
    expect((mockTranslate.mock.calls[0][0] as string).length).toBe(4500);
    expect((mockTranslate.mock.calls[1][0] as string).length).toBe(1500);
  });

  it("should fall back to original text per-chunk when one chunk fails", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    // Two paragraphs → two chunks
    const para = "p".repeat(3000);
    const text = `${para}\n\n${para}`;

    let callIdx = 0;
    mockTranslate.mockImplementation(async () => {
      callIdx++;
      if (callIdx === 1) return { text: "OK1" };
      // Second chunk fails on every retry
      throw new Error("rate limited");
    });

    const translator = createGoogleFreeTranslator();
    const promise = translator.translate(text, "auto", "en");

    // Drain backoff timers for the failing second chunk
    await flushRetryTimers();

    const result = await promise;
    // First chunk translates successfully, second falls back to original
    expect(result).toContain("OK1");
    expect(result).toContain(para);
    // First chunk: 1 call, second chunk: 3 retries → 4 total
    expect(mockTranslate).toHaveBeenCalledTimes(4);
  });

  it("should log error cause when present", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    const errorWithCause = new Error("TLS handshake failed");
    errorWithCause.cause = "ECONNRESET";
    mockTranslate
      .mockRejectedValueOnce(errorWithCause)
      .mockResolvedValueOnce({ text: "OK" });

    const translator = createGoogleFreeTranslator();
    const promise = translator.translate("test", "auto", "en");

    await vi.advanceTimersByTimeAsync(600);
    const result = await promise;

    expect(result).toBe("OK");
  });

  it("should handle empty string input", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    mockTranslate.mockResolvedValueOnce({ text: "" });

    const translator = createGoogleFreeTranslator();
    const result = await translator.translate("", "auto", "en");

    // Empty text → single chunk of "" → one call
    expect(result).toBe("");
    expect(mockTranslate).toHaveBeenCalledTimes(1);
  });

  it("should pass an explicit source language through unchanged", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    mockTranslate.mockResolvedValueOnce({ text: "Hello" });

    const translator = createGoogleFreeTranslator();
    await translator.translate("Bonjour", "fr", "en");

    expect(mockTranslate).toHaveBeenCalledWith("Bonjour", expect.objectContaining({
      from: "fr",
      to: "en",
    }));
  });

  it("should produce exactly one chunk for text at MAX_CHUNK_CHARS boundary", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    mockTranslate.mockImplementation(async (text: string) => ({ text }));

    const translator = createGoogleFreeTranslator();
    const input = "x".repeat(4500); // exactly MAX_CHUNK_CHARS
    const result = await translator.translate(input, "auto", "en");

    expect(result).toBe(input);
    expect(mockTranslate).toHaveBeenCalledTimes(1);
  });

  it("should handle text where paragraph split leaves empty remainder", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    mockTranslate.mockImplementation(async (text: string) => ({ text }));

    // 4500 chars + "\n\n" exactly — after first chunk split at paragraph
    // boundary, remaining is empty
    const input = "a".repeat(4500) + "\n\n";

    const translator = createGoogleFreeTranslator();
    const result = await translator.translate(input, "auto", "en");

    expect(result).toBe(input);
  });

  it("should handle concurrent translations on separate translator instances", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    let callCount = 0;
    mockTranslate.mockImplementation(async (text: string) => {
      callCount++;
      return { text: `T${callCount}:${text.slice(0, 5)}` };
    });

    const t1 = createGoogleFreeTranslator();
    const t2 = createGoogleFreeTranslator();

    const [r1, r2] = await Promise.all([
      t1.translate("テスト1", "auto", "en"),
      t2.translate("テスト2", "auto", "en"),
    ]);

    expect(r1).toMatch(/^T\d:テスト1/);
    expect(r2).toMatch(/^T\d:テスト2/);
    expect(mockTranslate).toHaveBeenCalledTimes(2);
  });

  it("should recover on second attempt after first attempt times out", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    // First attempt hangs, second succeeds immediately
    let callIdx = 0;
    mockTranslate.mockImplementation(async () => {
      callIdx++;
      if (callIdx === 1) {
        return new Promise(() => {}); // hang forever
      }
      return { text: "OK" };
    });

    const translator = createGoogleFreeTranslator();
    const promise = translator.translate("テスト", "auto", "en");

    // First attempt: timeout after 15s
    await vi.advanceTimersByTimeAsync(15_000);
    // Backoff: 500ms
    await vi.advanceTimersByTimeAsync(500);

    const result = await promise;
    expect(result).toBe("OK");
    expect(mockTranslate).toHaveBeenCalledTimes(2);
  });

  it("should handle multi-chunk text where middle chunk fails all retries", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    // Three paragraphs → three chunks
    const para = "p".repeat(3000);
    const text = `${para}\n\n${para}\n\n${para}`;

    let chunkIdx = 0;
    mockTranslate.mockImplementation(async () => {
      chunkIdx++;
      if (chunkIdx >= 2 && chunkIdx <= 4) {
        // Second chunk: 3 retries all fail
        throw new Error("rate limited");
      }
      return { text: "OK" };
    });

    const translator = createGoogleFreeTranslator();
    const promise = translator.translate(text, "auto", "en");

    await flushRetryTimers();
    const result = await promise;

    // First and third chunks translated, second falls back to original
    expect(result).toContain("OK");
    expect(result).toContain(para);
  });

  it("should handle text just over MAX_CHUNK_CHARS with surrogate pair at boundary", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    mockTranslate.mockImplementation(async (text: string) => ({ text }));

    // Place a surrogate pair (emoji 🎉 U+1F389) such that the high surrogate
    // is the last char of the first chunk and the low surrogate is the first
    // char of the second chunk when naively splitting at 4500.
    const prefix = "a".repeat(4499);
    const emoji = "🎉"; // 🎉
    const suffix = "b".repeat(500);
    const input = prefix + emoji + suffix;

    const translator = createGoogleFreeTranslator();
    const result = await translator.translate(input, "auto", "en");

    expect(result).toBe(input);
    // Verify no chunk starts with a lone low surrogate
    for (const call of mockTranslate.mock.calls) {
      const chunk = call[0] as string;
      if (chunk.length > 0) {
        const first = chunk.charCodeAt(0);
        expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
      }
    }
  });

  it("should handle all chunks failing independently with different errors", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    // Two chunks, both fail all retries with different errors
    const para = "p".repeat(3000);
    const text = `${para}\n\n${para}`;

    mockTranslate.mockRejectedValue(new Error("network error"));

    const translator = createGoogleFreeTranslator();
    const promise = translator.translate(text, "auto", "en");
    await flushRetryTimers();
    const result = await promise;

    // Both chunks fall back to original text
    expect(result).toBe(text);
    // 2 chunks × 3 retries = 6 calls
    expect(mockTranslate).toHaveBeenCalledTimes(6);
  });

  it("should handle text that is exactly one char over MAX_CHUNK_CHARS", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    mockTranslate.mockImplementation(async (text: string) => ({ text }));

    const input = "x".repeat(4501);
    const translator = createGoogleFreeTranslator();
    const result = await translator.translate(input, "auto", "en");

    expect(result).toBe(input);
    expect(mockTranslate).toHaveBeenCalledTimes(2);
    expect((mockTranslate.mock.calls[0][0] as string).length).toBe(4500);
    expect((mockTranslate.mock.calls[1][0] as string).length).toBe(1);
  });

  it("should handle error with cause property for logging", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    const err = new Error("connection failed");
    err.cause = "ECONNREFUSED";
    mockTranslate
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ text: "OK" });

    const translator = createGoogleFreeTranslator();
    const promise = translator.translate("test", "auto", "en");
    await vi.advanceTimersByTimeAsync(600);
    const result = await promise;

    expect(result).toBe("OK");
    const { logger: mockLogger } = await import("../../src/utils/logger.js");
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("ECONNREFUSED"),
    );
  });
});
