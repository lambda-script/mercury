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
});
