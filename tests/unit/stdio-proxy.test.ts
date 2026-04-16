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

// Create a mock child process with controllable stdio streams
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

// Mock spawn — returns a new child each time via currentChild
let currentChild: ReturnType<typeof createMockChild>;
const mockSpawn = vi.fn(() => currentChild);

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Capture stdout writes
let stdoutWrites: string[];
const realStdoutWrite = process.stdout.write;

// We need a fresh process.stdin for each test
let mockStdin: PassThrough;

describe("stdio proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWrites = [];

    // Each createStdioProxy() call registers SIGINT/SIGTERM handlers via
    // process.once. They are not removed unless the signal fires, so they
    // accumulate across tests and trip the MaxListeners warning. Reset between
    // tests so we start clean.
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");

    // Fresh child for each test
    currentChild = createMockChild();

    // Capture stdout
    process.stdout.write = vi.fn((chunk: unknown) => {
      stdoutWrites.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write;

    // Fresh stdin
    mockStdin = new PassThrough();
    Object.defineProperty(process, "stdin", {
      value: mockStdin,
      writable: true,
      configurable: true,
    });

    // Mock process.exit
    (process as unknown as Record<string, unknown>).exit = vi.fn();
  });

  afterEach(() => {
    process.stdout.write = realStdoutWrite;
    // child.stderr.pipe(process.stderr) leaks listeners on the global stderr
    // socket between tests; unpipe before destroying.
    currentChild.mockStderr.unpipe(process.stderr);
    mockStdin.destroy();
    currentChild.mockStdout.destroy();
    currentChild.mockStderr.destroy();
    currentChild.mockStdin.destroy();
  });

  function getOutputMessages(): Record<string, unknown>[] {
    return stdoutWrites
      .map((w) => w.trim())
      .filter(Boolean)
      .map((w) => JSON.parse(w) as Record<string, unknown>);
  }

  async function createProxy(
    detector?: { detect: ReturnType<typeof vi.fn>; isTargetLang: ReturnType<typeof vi.fn> },
    translator?: { translate: ReturnType<typeof vi.fn> },
  ) {
    // Dynamic import to get a fresh module context bound to current mocks
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

  it("should forward JSON-RPC notifications from server unchanged", async () => {
    await createProxy();

    currentChild.mockStdout.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progress: 50 } }) + "\n",
    );

    await new Promise((r) => setTimeout(r, 50));

    const messages = getOutputMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].method).toBe("notifications/progress");
  });

  it("should pass through responses for non-tracked request IDs", async () => {
    await createProxy();

    currentChild.mockStdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: 999, result: { some: "data" } }) + "\n",
    );

    await new Promise((r) => setTimeout(r, 50));

    const messages = getOutputMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(999);
    expect(messages[0].result).toEqual({ some: "data" });
  });

  it("should silently drop malformed JSON lines from server", async () => {
    await createProxy();

    currentChild.mockStdout.write("this is not json\n");
    currentChild.mockStdout.write("{malformed json\n");
    currentChild.mockStdout.write("\n");

    await new Promise((r) => setTimeout(r, 50));

    expect(getOutputMessages()).toHaveLength(0);
  });

  it("should drop non-object JSON values from server", async () => {
    await createProxy();

    currentChild.mockStdout.write("[1, 2, 3]\n");
    currentChild.mockStdout.write('"just a string"\n');

    await new Promise((r) => setTimeout(r, 50));

    expect(getOutputMessages()).toHaveLength(0);
  });

  it("should strip outputSchema from tools/list responses", async () => {
    await createProxy();

    // Client sends tools/list request (tracked via stdin readline)
    mockStdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 42, method: "tools/list" }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    // Server responds with tools that have outputSchema
    currentChild.mockStdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 42,
        result: {
          tools: [
            {
              name: "read_file",
              description: "Read a file",
              inputSchema: { type: "object" },
              outputSchema: { type: "object", properties: { content: { type: "string" } } },
            },
          ],
        },
      }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    const messages = getOutputMessages();
    const response = messages.find((m) => m.id === 42 && m.result);
    expect(response).toBeDefined();
    const tools = (response!.result as { tools: Record<string, unknown>[] }).tools;
    expect(tools[0]).not.toHaveProperty("outputSchema");
    expect(tools[0]).toHaveProperty("name", "read_file");
    expect(tools[0]).toHaveProperty("inputSchema");
  });

  it("should translate tools/call results", async () => {
    const detector = {
      detect: vi.fn(() => ({ lang: "jpn", confidence: 1 })),
      isTargetLang: vi.fn(() => false),
    };
    const translator = {
      translate: vi.fn(async () => "Hello"),
    };

    const proxy = await createProxy(detector, translator);

    // Client sends tools/call request
    mockStdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "test" } }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    // Server responds with Japanese text
    currentChild.mockStdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 10,
        result: {
          content: [{ type: "text", text: "こんにちは世界、これはテストです。" }],
        },
      }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 100));

    const messages = getOutputMessages();
    const response = messages.find((m) => m.id === 10 && m.result);
    expect(response).toBeDefined();
    expect((response!.result as { content: { text: string }[] }).content[0].text).toBe("Hello");
    expect(proxy.stats.toolCallsTranslated).toBe(1);
  });

  it("should forward original result on transform error", async () => {
    const detector = {
      detect: vi.fn(() => { throw new Error("detector boom"); }),
      isTargetLang: vi.fn(() => { throw new Error("detector boom"); }),
    };
    const translator = {
      translate: vi.fn(async () => { throw new Error("translator boom"); }),
    };

    await createProxy(detector, translator);

    // Track a tools/call request
    mockStdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 20, method: "tools/call", params: {} }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    // Server responds — transform will error
    const originalResult = { content: [{ type: "text", text: "some text" }] };
    currentChild.mockStdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: 20, result: originalResult }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 100));

    const messages = getOutputMessages();
    const response = messages.find((m) => m.id === 20);
    expect(response).toBeDefined();
    // Original result preserved on error
    expect(response!.result).toEqual(originalResult);
  });

  it("should forward signal to child on shutdown", async () => {
    await createProxy();

    // Emit SIGTERM on process
    process.emit("SIGTERM" as unknown as "disconnect");

    expect(currentChild.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("should not crash when child stdin emits an error", async () => {
    await createProxy();

    // Simulate EPIPE on child stdin (e.g. child crashed mid-write).
    // Without an error listener attached by the proxy, this would
    // become an unhandled 'error' event and terminate the process.
    expect(() => {
      currentChild.mockStdin.emit("error", new Error("EPIPE"));
    }).not.toThrow();
  });

  it("should not crash when child stdout emits an error", async () => {
    await createProxy();

    expect(() => {
      currentChild.mockStdout.emit("error", new Error("EPIPE"));
    }).not.toThrow();
  });

  it("should not crash when writing to child stdin throws synchronously", async () => {
    await createProxy();

    // Replace stdin.write with one that throws (e.g. EPIPE on a destroyed pipe)
    currentChild.mockStdin.write = vi.fn(() => {
      throw new Error("EPIPE");
    }) as unknown as typeof currentChild.mockStdin.write;

    // Client sends a request — proxy should swallow the write error
    expect(() => {
      mockStdin.write(
        JSON.stringify({ jsonrpc: "2.0", id: 50, method: "tools/list" }) + "\n",
      );
    }).not.toThrow();

    await new Promise((r) => setTimeout(r, 50));
  });

  it("should preserve message ordering across concurrent translations", async () => {
    // Use detectors that mark all text as needing translation
    const detector = {
      detect: vi.fn(() => ({ lang: "jpn", confidence: 1 })),
      isTargetLang: vi.fn(() => false),
    };

    // Each translation resolves at a different speed:
    // First call resolves last, second middle, third first.
    // Despite this, the proxy must serialize and emit responses in order.
    const delays = [60, 30, 10];
    let callIdx = 0;
    const translator = {
      translate: vi.fn(() => {
        const idx = callIdx++;
        return new Promise<string>((resolve) => {
          setTimeout(() => resolve(`translated-${idx}`), delays[idx]);
        });
      }),
    };

    await createProxy(detector, translator);

    // Track three tools/call requests
    for (const id of [101, 102, 103]) {
      mockStdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: {} }) + "\n",
      );
    }
    await new Promise((r) => setTimeout(r, 20));

    // Server emits three responses back-to-back
    for (const id of [101, 102, 103]) {
      currentChild.mockStdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: `テキスト${id}` }] },
        }) + "\n",
      );
    }

    // Wait for all translations to drain
    await new Promise((r) => setTimeout(r, 200));

    const messages = getOutputMessages().filter((m) => m.id !== undefined);
    // Order must be preserved: 101 → 102 → 103, even though their
    // translations resolve in opposite order.
    expect(messages.map((m) => m.id)).toEqual([101, 102, 103]);
    // And each got the translation that was running for its slot.
    expect((messages[0].result as { content: { text: string }[] }).content[0].text).toBe("translated-0");
    expect((messages[1].result as { content: { text: string }[] }).content[0].text).toBe("translated-1");
    expect((messages[2].result as { content: { text: string }[] }).content[0].text).toBe("translated-2");
  });

  it("should handle a large response with many text content blocks", async () => {
    const detector = {
      detect: vi.fn(() => ({ lang: "jpn", confidence: 1 })),
      isTargetLang: vi.fn(() => false),
    };
    const translator = {
      translate: vi.fn(async (text: string) => text.toUpperCase()),
    };

    const proxy = await createProxy(detector, translator);

    mockStdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 50, method: "tools/call", params: {} }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 20));

    // Construct a result with 25 text blocks, each long enough to be translated
    const blocks = Array.from({ length: 25 }, (_, i) => ({
      type: "text",
      text: `これは長い日本語のブロック番号 ${i} です。翻訳されるべき内容です。`,
    }));
    currentChild.mockStdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: 50, result: { content: blocks } }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 100));

    expect(translator.translate).toHaveBeenCalledTimes(25);
    const messages = getOutputMessages();
    const response = messages.find((m) => m.id === 50);
    const out = (response!.result as { content: { text: string }[] }).content;
    expect(out).toHaveLength(25);
    expect(out[0].text).toBe(out[0].text.toUpperCase());
    expect(proxy.stats.toolCallsTranslated).toBe(1);
  });

  it("should pass through server-to-client requests (e.g., sampling)", async () => {
    await createProxy();

    // Server sends a request to the client (sampling/createMessage), not a response.
    // It has both id AND method, so isResponse() is false.
    currentChild.mockStdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "sampling/createMessage",
        params: { messages: [] },
      }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    const messages = getOutputMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].method).toBe("sampling/createMessage");
    expect(messages[0].id).toBe(7);
  });

  it("should handle multiple JSON-RPC messages on consecutive lines from server", async () => {
    await createProxy();

    // Three messages in one write — readline should split them
    const payload =
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: 1 } }) + "\n" +
      JSON.stringify({ jsonrpc: "2.0", id: 2, result: { ok: 2 } }) + "\n" +
      JSON.stringify({ jsonrpc: "2.0", id: 3, result: { ok: 3 } }) + "\n";
    currentChild.mockStdout.write(payload);

    await new Promise((r) => setTimeout(r, 50));

    const messages = getOutputMessages();
    expect(messages).toHaveLength(3);
    expect(messages.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it("should not crash when client sends notifications (no id)", async () => {
    await createProxy();

    // Notification from client to server: has method, no id
    mockStdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    // Should be forwarded to child stdin verbatim
    const childStdinData: string[] = [];
    currentChild.mockStdin.on("data", (chunk: Buffer) => {
      childStdinData.push(chunk.toString());
    });

    // Send another to confirm forwarding still works
    mockStdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 99, method: "ping" }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    expect(childStdinData.join("")).toContain('"ping"');
  });

  it("should reject when spawn() throws synchronously", async () => {
    mockSpawn.mockImplementationOnce(() => {
      throw new Error("ENOENT: command not found");
    });

    const { createStdioProxy } = await import("../../src/proxy/stdio.js");
    const detector = {
      detect: vi.fn(() => ({ lang: "eng", confidence: 1 })),
      isTargetLang: vi.fn(() => true),
    };
    const translator = { translate: vi.fn(async (t: string) => t) };

    const proxy = createStdioProxy("nonexistent", [], detector, translator, "en");
    await expect(proxy.start()).rejects.toThrow("ENOENT");
  });

  it("should reject start() when spawn throws a non-Error value", async () => {
    const { createStdioProxy } = await import("../../src/proxy/stdio.js");

    mockSpawn.mockImplementationOnce(() => {
      throw "string failure";
    });

    const proxy = createStdioProxy(
      "missing-cmd",
      [],
      { detect: vi.fn(), isTargetLang: vi.fn() },
      { translate: vi.fn() },
      "en",
    );

    await expect(proxy.start()).rejects.toThrow("string failure");
  });

  it("should reject start() when child stdio pipes are unavailable", async () => {
    const { createStdioProxy } = await import("../../src/proxy/stdio.js");

    // Return a child whose stdio pipes are missing
    const brokenChild = createMockChild();
    (brokenChild as unknown as Record<string, unknown>).stdin = null;
    (brokenChild as unknown as Record<string, unknown>).stdout = null;
    (brokenChild as unknown as Record<string, unknown>).stderr = null;
    mockSpawn.mockImplementationOnce(() => brokenChild);

    const proxy = createStdioProxy(
      "broken-cmd",
      [],
      { detect: vi.fn(), isTargetLang: vi.fn() },
      { translate: vi.fn() },
      "en",
    );

    await expect(proxy.start()).rejects.toThrow(/stdio pipes/);
  });

  it("should handle child process error without crashing", async () => {
    const { createStdioProxy } = await import("../../src/proxy/stdio.js");

    const proxy = createStdioProxy(
      "echo",
      [],
      { detect: vi.fn(), isTargetLang: vi.fn() },
      { translate: vi.fn() },
      "en",
    );

    await proxy.start();

    // The error handler logs the error but does not throw or crash the proxy.
    expect(() => currentChild.emit("error", new Error("child boom"))).not.toThrow();
  });

  it("should pass through tools/list response with no result", async () => {
    await createProxy();

    mockStdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 50, method: "tools/list" }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    currentChild.mockStdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: 50, error: { code: -32603, message: "boom" } }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    const messages = getOutputMessages();
    const response = messages.find((m) => m.id === 50);
    expect(response).toBeDefined();
    expect(response!.error).toEqual({ code: -32603, message: "boom" });
  });

  it("should pass through tools/call response with no result", async () => {
    await createProxy();

    mockStdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 51, method: "tools/call", params: {} }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    currentChild.mockStdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: 51, error: { code: -32603, message: "boom" } }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    const messages = getOutputMessages();
    const response = messages.find((m) => m.id === 51);
    expect(response).toBeDefined();
    expect(response!.error).toEqual({ code: -32603, message: "boom" });
  });

  it("should drain server queue before exiting on child exit", async () => {
    // Use a translator with a delay to simulate in-flight work
    let resolveTranslation: (value: string) => void;
    const translationPromise = new Promise<string>((resolve) => {
      resolveTranslation = resolve;
    });

    const detector = {
      detect: vi.fn(() => ({ lang: "jpn", confidence: 1 })),
      isTargetLang: vi.fn(() => false),
    };
    const translator = {
      translate: vi.fn(() => translationPromise),
    };

    const proxy = await createProxy(detector, translator);

    // Track a tools/call
    mockStdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 30, method: "tools/call", params: {} }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    // Server responds — translation starts but doesn't resolve yet
    currentChild.mockStdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 30,
        result: { content: [{ type: "text", text: "テスト" }] },
      }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    // Child exits while translation is in-flight
    currentChild.emit("exit", 0, null);
    await new Promise((r) => setTimeout(r, 50));

    // process.exit should NOT have been called yet (queue not drained)
    expect(process.exit).not.toHaveBeenCalled();

    // Now resolve the translation
    resolveTranslation!("Test");
    await new Promise((r) => setTimeout(r, 50));

    // Now process.exit should have been called
    expect(process.exit).toHaveBeenCalledWith(0);
  });
});
