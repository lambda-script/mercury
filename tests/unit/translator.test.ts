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

  it("should split on single newline when no paragraph break exists", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    // No "\n\n", but lots of "\n" — forces single-newline branch (line 46)
    const line = "x".repeat(100);
    const lines: string[] = [];
    for (let i = 0; i < 80; i++) lines.push(line);
    const text = lines.join("\n"); // ~8080 chars, only single newlines

    const captured: string[] = [];
    mockTranslate.mockImplementation(async (chunk: string) => {
      captured.push(chunk);
      return { text: `T${chunk.length}` };
    });

    const translator = createGoogleFreeTranslator();
    await translator.translate(text, "auto", "en");

    expect(captured.length).toBeGreaterThan(1);
    // Each chunk must be under the 4500 limit
    for (const c of captured) expect(c.length).toBeLessThanOrEqual(4500);
  });

  it("should split on sentence boundary when no newlines exist", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    // No newlines at all, only ". " sentence breaks (line 50-51 branch)
    const sentence = "x".repeat(80) + ". ";
    let text = "";
    while (text.length < 9000) text += sentence;

    const captured: string[] = [];
    mockTranslate.mockImplementation(async (chunk: string) => {
      captured.push(chunk);
      return { text: "ok" };
    });

    const translator = createGoogleFreeTranslator();
    await translator.translate(text, "auto", "en");

    expect(captured.length).toBeGreaterThan(1);
    for (const c of captured) expect(c.length).toBeLessThanOrEqual(4500);
  });

  it("should hard-split text with no boundaries at all", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    // No newlines, no sentence breaks — pure hard split (line 55)
    const text = "x".repeat(10000);

    const captured: string[] = [];
    mockTranslate.mockImplementation(async (chunk: string) => {
      captured.push(chunk);
      return { text: "ok" };
    });

    const translator = createGoogleFreeTranslator();
    await translator.translate(text, "auto", "en");

    expect(captured.length).toBeGreaterThanOrEqual(3);
    expect(captured[0].length).toBe(4500);
  });

  it("should pass through 'auto' from-lang verbatim", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );
    mockTranslate.mockResolvedValueOnce({ text: "ok" });

    const translator = createGoogleFreeTranslator();
    await translator.translate("hello world from auto", "auto", "en");

    expect(mockTranslate.mock.calls[0][1].from).toBe("auto");
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
});
