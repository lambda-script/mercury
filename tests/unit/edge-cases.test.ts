import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";

// Mock logger to suppress output during tests
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createMockChild() {
  const child = new EventEmitter() as ChildProcess & {
    mockStdout: PassThrough;
    mockStderr: PassThrough;
    mockStdin: PassThrough;
  };

  child.mockStdout = new PassThrough();
  child.mockStderr = new PassThrough();
  child.mockStdin = new PassThrough();

  (child as unknown as Record<string, unknown>).stdout = child.mockStdout;
  (child as unknown as Record<string, unknown>).stderr = child.mockStderr;
  (child as unknown as Record<string, unknown>).stdin = child.mockStdin;
  (child as unknown as Record<string, unknown>).pid = 12345;
  child.kill = vi.fn().mockReturnValue(true);

  return child;
}

let currentChild: ReturnType<typeof createMockChild>;
const mockSpawn = vi.fn(() => currentChild);

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

let stdoutWrites: string[];
const realStdoutWrite = process.stdout.write;
let mockStdin: PassThrough;

describe("stdio proxy edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWrites = [];
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    currentChild = createMockChild();

    process.stdout.write = vi.fn((chunk: unknown) => {
      stdoutWrites.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write;

    mockStdin = new PassThrough();
    Object.defineProperty(process, "stdin", {
      value: mockStdin,
      writable: true,
      configurable: true,
    });

    (process as unknown as Record<string, unknown>).exit = vi.fn();
  });

  afterEach(() => {
    process.stdout.write = realStdoutWrite;
    currentChild.mockStderr.unpipe(process.stderr);
    mockStdin.destroy();
    currentChild.mockStdout.destroy();
    currentChild.mockStderr.destroy();
    currentChild.mockStdin.destroy();
  });

  async function createProxy(
    detector?: { detect: ReturnType<typeof vi.fn>; isTargetLang: ReturnType<typeof vi.fn> },
    translator?: { translate: ReturnType<typeof vi.fn> },
  ) {
    const { createStdioProxy } = await import("../../src/proxy/stdio.js");

    const det = detector ?? {
      detect: vi.fn(() => ({ lang: "eng", confidence: 1 })),
      isTargetLang: vi.fn(() => true),
    };
    const trans = translator ?? {
      translate: vi.fn(async (text: string) => text),
    };

    const proxy = createStdioProxy("echo", [], det, trans, "en");
    await proxy.start();
    return proxy;
  }

  it("should not crash when child stderr emits an error", async () => {
    await createProxy();

    expect(() => {
      currentChild.mockStderr.emit("error", new Error("EPIPE on stderr"));
    }).not.toThrow();
  });

  it("should not duplicate shutdown when receiving SIGINT after SIGTERM", async () => {
    await createProxy();

    process.emit("SIGTERM" as unknown as "disconnect");
    process.emit("SIGINT" as unknown as "disconnect");

    // kill should only be called once (the second signal is ignored)
    expect(currentChild.kill).toHaveBeenCalledTimes(1);
    expect(currentChild.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("should increment toolCallsPassedThrough for target-lang tool results", async () => {
    const detector = {
      detect: vi.fn(() => ({ lang: "eng", confidence: 1 })),
      isTargetLang: vi.fn(() => true),
    };
    const translator = { translate: vi.fn(async (t: string) => t) };

    const proxy = await createProxy(detector, translator);

    mockStdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    currentChild.mockStdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [{ type: "text", text: "This is already English text." }],
        },
      }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 100));

    expect(proxy.stats.toolCallsPassedThrough).toBe(1);
    expect(proxy.stats.toolCallsTranslated).toBe(0);
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("should handle whitespace-only lines from server without crashing", async () => {
    await createProxy();

    currentChild.mockStdout.write("   \t   \n");
    currentChild.mockStdout.write("  \n");
    await new Promise((r) => setTimeout(r, 50));

    expect(stdoutWrites).toHaveLength(0);
  });

  it("should handle rapid-fire requests with interleaved notifications", async () => {
    const detector = {
      detect: vi.fn(() => ({ lang: "jpn", confidence: 1 })),
      isTargetLang: vi.fn(() => false),
    };
    const translator = {
      translate: vi.fn(async (text: string) => `EN:${text}`),
    };

    await createProxy(detector, translator);

    // Track two tools/call requests
    mockStdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }) + "\n",
    );
    mockStdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: {} }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 30));

    // Server sends: response 1, a notification, response 2
    currentChild.mockStdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "テキスト1" }] },
      }) + "\n",
    );
    currentChild.mockStdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: { progress: 50 },
      }) + "\n",
    );
    currentChild.mockStdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: { content: [{ type: "text", text: "テキスト2" }] },
      }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 200));

    const messages = stdoutWrites
      .map((w) => w.trim())
      .filter(Boolean)
      .map((w) => JSON.parse(w) as Record<string, unknown>);

    // Order preserved: response 1, notification, response 2
    expect(messages).toHaveLength(3);
    expect(messages[0].id).toBe(1);
    expect(messages[1].method).toBe("notifications/progress");
    expect(messages[2].id).toBe(2);
  });

  it("should close child stdin when process stdin ends", async () => {
    await createProxy();

    const endSpy = vi.spyOn(currentChild.mockStdin, "end");
    mockStdin.emit("end");
    await new Promise((r) => setTimeout(r, 50));

    expect(endSpy).toHaveBeenCalled();
  });
});

// ─── stripOutputSchemas unit tests ───

describe("stripOutputSchemas", () => {
  it("should handle non-tool entries in the tools array", async () => {
    const { stripOutputSchemas } = await import("../../src/proxy/stdio.js");

    const result = stripOutputSchemas({
      tools: [null, undefined, 42, "string", { name: "test", outputSchema: { type: "object" } }],
    });

    const tools = (result as { tools: unknown[] }).tools;
    expect(tools[0]).toBeNull();
    expect(tools[1]).toBeUndefined();
    expect(tools[2]).toBe(42);
    expect(tools[3]).toBe("string");
    expect(tools[4]).not.toHaveProperty("outputSchema");
    expect(tools[4]).toHaveProperty("name", "test");
  });

  it("should return input unchanged when tools is not an array", async () => {
    const { stripOutputSchemas } = await import("../../src/proxy/stdio.js");

    const input = { tools: "not-an-array" };
    expect(stripOutputSchemas(input)).toBe(input);
  });

  it("should return primitives unchanged", async () => {
    const { stripOutputSchemas } = await import("../../src/proxy/stdio.js");

    expect(stripOutputSchemas(null)).toBeNull();
    expect(stripOutputSchemas(undefined)).toBeUndefined();
    expect(stripOutputSchemas(42)).toBe(42);
  });
});

// ─── tool-result JSON object reconstruction ───

describe("tool-result JSON object reconstruction", () => {
  it("should translate multiple string values in a flat JSON object", async () => {
    const { transformToolResult } = await import("../../src/transform/tool-result.js");

    const longJa1 = "これは最初の長い日本語テキストです。翻訳されるべきです。";
    const longJa2 = "これは二番目の長い日本語テキストです。翻訳されるべきです。";
    const jsonText = JSON.stringify({ title: longJa1, description: longJa2, count: 42 });
    const result = {
      content: [{ type: "text" as const, text: jsonText }],
    };

    const detector = {
      detect: vi.fn(() => ({ lang: "jpn", confidence: 1 })),
      isTargetLang: vi.fn(() => false),
    };
    const translator = {
      translate: vi.fn(async (text: string) => `[EN] ${text}`),
    };

    const { content, stats } = await transformToolResult(result, detector, translator, "en");

    const transformed = content as typeof result;
    const parsed = JSON.parse(transformed.content[0].text);
    expect(parsed.title).toBe(`[EN] ${longJa1}`);
    expect(parsed.description).toBe(`[EN] ${longJa2}`);
    expect(parsed.count).toBe(42);
    expect(stats.blocksTranslated).toBe(2);
  });

  it("should reconstruct nested objects after translation", async () => {
    const { transformToolResult } = await import("../../src/transform/tool-result.js");

    const longJa = "これは深いネストの中にある長い日本語テキストです。翻訳が必要です。";
    const jsonText = JSON.stringify({
      outer: {
        inner: {
          message: longJa,
        },
        id: 123,
      },
    });
    const result = {
      content: [{ type: "text" as const, text: jsonText }],
    };

    const detector = {
      detect: vi.fn(() => ({ lang: "jpn", confidence: 1 })),
      isTargetLang: vi.fn(() => false),
    };
    const translator = {
      translate: vi.fn(async (text: string) => `[EN] ${text}`),
    };

    const { content } = await transformToolResult(result, detector, translator, "en");
    const transformed = content as typeof result;
    const parsed = JSON.parse(transformed.content[0].text);
    expect(parsed.outer.inner.message).toBe(`[EN] ${longJa}`);
    expect(parsed.outer.id).toBe(123);
  });

  it("should skip file paths in JSON values", async () => {
    const { transformToolResult } = await import("../../src/transform/tool-result.js");

    const longPath = "/home/user/documents/very/long/path/to/some/file.txt";
    const dotPath = "./relative/path/to/another/file/somewhere/deep";
    const tildePath = "~/home/user/.config/some/application/settings";
    const jsonText = JSON.stringify({
      absPath: longPath,
      relPath: dotPath,
      homePath: tildePath,
    });
    const result = {
      content: [{ type: "text" as const, text: jsonText }],
    };

    const translator = {
      translate: vi.fn(async (text: string) => `[EN] ${text}`),
    };
    const detector = {
      detect: vi.fn(() => ({ lang: "jpn", confidence: 1 })),
      isTargetLang: vi.fn(() => false),
    };

    await transformToolResult(result, detector, translator, "en");
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("should skip ISO date strings in JSON values", async () => {
    const { transformToolResult } = await import("../../src/transform/tool-result.js");

    const jsonText = JSON.stringify({
      createdAt: "2024-01-15T10:30:00Z is the creation date",
    });
    const result = {
      content: [{ type: "text" as const, text: jsonText }],
    };

    const translator = {
      translate: vi.fn(async (text: string) => `[EN] ${text}`),
    };
    const detector = {
      detect: vi.fn(() => ({ lang: "jpn", confidence: 1 })),
      isTargetLang: vi.fn(() => false),
    };

    await transformToolResult(result, detector, translator, "en");
    expect(translator.translate).not.toHaveBeenCalled();
  });
});

// ─── google-free translator edge cases ───

const mockTranslate = vi.fn();
vi.mock("google-translate-api-x", () => ({
  default: mockTranslate,
}));

describe("Google Free Translator edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should format errors with cause property", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    const errorWithCause = new Error("Outer error");
    (errorWithCause as Error & { cause: string }).cause = "Inner cause";

    mockTranslate
      .mockRejectedValueOnce(errorWithCause)
      .mockResolvedValueOnce({ text: "OK" });

    const translator = createGoogleFreeTranslator();
    const promise = translator.translate("テスト", "auto", "en");

    await vi.advanceTimersByTimeAsync(600);
    const result = await promise;
    expect(result).toBe("OK");
  });

  it("should push remaining text as final chunk after splitting", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    // Text with a trailing \n\n so the last split consumes exactly everything,
    // leaving remaining === "". Verifies the `remaining.length > 0` guard.
    const para = "x".repeat(4500);
    const text = `${para}\n\n${para}\n\n`;

    const chunks: string[] = [];
    mockTranslate.mockImplementation(async (chunk: string) => {
      chunks.push(chunk);
      return { text: chunk };
    });

    const translator = createGoogleFreeTranslator();
    const result = await translator.translate(text, "auto", "en");

    // Two chunks, no empty remainder pushed
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(para);
    expect(chunks[1]).toBe(para);
    // Reassembled with separators
    expect(result).toBe(text);
  });

  it("should clear timeout timer on successful translation", async () => {
    const { createGoogleFreeTranslator } = await import(
      "../../src/translator/google-free.js"
    );

    mockTranslate.mockResolvedValueOnce({ text: "Success" });

    const translator = createGoogleFreeTranslator();
    const result = await translator.translate("テスト", "auto", "en");

    expect(result).toBe("Success");
    // If the timer wasn't cleared, advancing time would cause issues
    await vi.advanceTimersByTimeAsync(20_000);
  });
});

// ─── tracker capacity eviction edge case ───

describe("tracker capacity eviction edge case", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should find and evict the oldest entry even when it is first in iteration order", async () => {
    const { createRequestTracker } = await import("../../src/proxy/tracker.js");

    const tracker = createRequestTracker();

    // Add entry 0 at t=0 (oldest)
    vi.setSystemTime(new Date(1000));
    tracker.track(0, "tools/call");

    // Add remaining entries at later times
    for (let i = 1; i < 1000; i++) {
      vi.setSystemTime(new Date(1000 + i));
      tracker.track(i, "tools/call");
    }

    // Add entry 1000 — should evict entry 0 (the oldest, first in Map iteration order)
    vi.setSystemTime(new Date(2000));
    tracker.track(1000, "tools/list");

    expect(tracker.size).toBe(1000);
    expect(tracker.take(0)).toBeUndefined();
    expect(tracker.take(1000)).toBe("tools/list");
    expect(tracker.take(1)).toBe("tools/call");
  });

  it("should evict middle entry when it is oldest due to re-tracking", async () => {
    const { createRequestTracker } = await import("../../src/proxy/tracker.js");

    const tracker = createRequestTracker();

    // Fill to capacity, but entry 500 gets the earliest timestamp
    vi.setSystemTime(new Date(500));
    tracker.track(500, "tools/call");

    vi.setSystemTime(new Date(1000));
    for (let i = 0; i < 1000; i++) {
      if (i === 500) continue;
      tracker.track(i, "tools/call");
    }

    // Now entry 500 has ts=500 (oldest), everything else has ts=1000
    vi.setSystemTime(new Date(2000));
    tracker.track(1001, "tools/list");

    expect(tracker.take(500)).toBeUndefined(); // was evicted as oldest
    expect(tracker.take(1001)).toBe("tools/list");
  });
});
