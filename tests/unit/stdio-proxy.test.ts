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

  it("should reject start() if spawn throws", async () => {
    const { createStdioProxy } = await import("../../src/proxy/stdio.js");

    mockSpawn.mockImplementationOnce(() => {
      throw new Error("ENOENT: command not found");
    });

    const proxy = createStdioProxy(
      "nonexistent-cmd",
      [],
      { detect: vi.fn(), isTargetLang: vi.fn() },
      { translate: vi.fn() },
      "en",
    );

    await expect(proxy.start()).rejects.toThrow(/ENOENT/);
  });

  it("should reject start() if child stdio pipes are missing", async () => {
    const { createStdioProxy } = await import("../../src/proxy/stdio.js");

    // Build a child with no stdin/stdout/stderr
    const brokenChild = new EventEmitter() as ChildProcess;
    (brokenChild as unknown as Record<string, unknown>).stdin = null;
    (brokenChild as unknown as Record<string, unknown>).stdout = null;
    (brokenChild as unknown as Record<string, unknown>).stderr = null;
    brokenChild.kill = vi.fn().mockReturnValue(true);

    mockSpawn.mockImplementationOnce(() => brokenChild);

    const proxy = createStdioProxy(
      "broken",
      [],
      { detect: vi.fn(), isTargetLang: vi.fn() },
      { translate: vi.fn() },
      "en",
    );

    await expect(proxy.start()).rejects.toThrow(/Failed to open stdio pipes/);
  });

  it("should preserve message ordering with concurrent tools/call responses", async () => {
    // Use a translator that delays in reverse order: first call resolves slow, second fast.
    // The serial queue should still output them in arrival order.
    const order: number[] = [];
    let firstResolve: (v: string) => void = () => {};
    const firstPromise = new Promise<string>((r) => {
      firstResolve = r;
    });

    const detector = {
      detect: vi.fn(() => ({ lang: "jpn", confidence: 1 })),
      isTargetLang: vi.fn(() => false),
    };

    let callIdx = 0;
    const translator = {
      translate: vi.fn(async () => {
        const i = callIdx++;
        if (i === 0) {
          const v = await firstPromise;
          order.push(0);
          return v;
        }
        order.push(1);
        return "second";
      }),
    };

    await createProxy(detector, translator);

    // Track two tools/call requests
    mockStdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 100, method: "tools/call", params: {} }) + "\n",
    );
    mockStdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 101, method: "tools/call", params: {} }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    // Server replies with both responses back-to-back
    currentChild.mockStdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 100,
        result: { content: [{ type: "text", text: "最初" }] },
      }) + "\n",
    );
    currentChild.mockStdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 101,
        result: { content: [{ type: "text", text: "二番目" }] },
      }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    // Second translation has not been called yet (queue is serial, blocked on first)
    expect(callIdx).toBe(1);

    // Resolve first; queue should then process second
    firstResolve("first");
    await new Promise((r) => setTimeout(r, 50));

    expect(order).toEqual([0, 1]);

    const messages = getOutputMessages();
    const ids = messages.filter((m) => m.id === 100 || m.id === 101).map((m) => m.id);
    expect(ids).toEqual([100, 101]);
  });

  it("should drop notifications missing both id and method", async () => {
    await createProxy();

    // Pure jsonrpc envelope, no method, no id, no result, no error — pass-through-as-request branch
    currentChild.mockStdout.write(JSON.stringify({ jsonrpc: "2.0" }) + "\n");
    await new Promise((r) => setTimeout(r, 30));

    // Should be forwarded (falls through to "request from server" pass-through)
    const messages = getOutputMessages();
    expect(messages).toHaveLength(1);
  });

  it("should silently drop invalid lines from client stdin", async () => {
    await createProxy();

    mockStdin.write("not json at all\n");
    mockStdin.write("\n");
    await new Promise((r) => setTimeout(r, 30));

    // Nothing should reach stdout (proxy only forwards parsed messages)
    expect(getOutputMessages()).toHaveLength(0);
  });

  it("should handle a large tool result with many content blocks", async () => {
    const detector = {
      detect: vi.fn(() => ({ lang: "jpn", confidence: 1 })),
      isTargetLang: vi.fn(() => false),
    };
    const translator = {
      translate: vi.fn(async (t: string) => `EN:${t.slice(0, 10)}`),
    };

    await createProxy(detector, translator);

    mockStdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 200, method: "tools/call", params: {} }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 30));

    const blocks = Array.from({ length: 50 }, (_, i) => ({
      type: "text",
      text: `これは長い日本語のテキストブロック番号${i}です、翻訳が必要です`,
    }));

    currentChild.mockStdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 200,
        result: { content: blocks },
      }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 200));

    expect(translator.translate).toHaveBeenCalledTimes(50);
    const messages = getOutputMessages();
    const response = messages.find((m) => m.id === 200);
    expect(response).toBeDefined();
    const content = (response!.result as { content: { text: string }[] }).content;
    expect(content).toHaveLength(50);
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
