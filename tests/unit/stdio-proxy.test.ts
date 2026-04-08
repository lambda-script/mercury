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

  it("should serialize translations and emit responses in arrival order", async () => {
    // The serverQueue serializes translation work — even though both responses
    // arrive back-to-back, only one translator call should be in flight at a
    // time, and the responses must be emitted in arrival order.
    let inFlight = 0;
    let observedMaxInFlight = 0;
    const detector = {
      detect: vi.fn(() => ({ lang: "jpn", confidence: 1 })),
      isTargetLang: vi.fn(() => false),
    };
    const translator = {
      translate: vi.fn(async (text: string) => {
        inFlight += 1;
        observedMaxInFlight = Math.max(observedMaxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 30));
        inFlight -= 1;
        return `EN:${text}`;
      }),
    };

    await createProxy(detector, translator);

    mockStdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }) + "\n",
    );
    mockStdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: {} }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 30));

    currentChild.mockStdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "first" }] },
      }) + "\n",
    );
    currentChild.mockStdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: { content: [{ type: "text", text: "second" }] },
      }) + "\n",
    );
    // Wait long enough for both translations to run sequentially (~60ms+)
    await new Promise((r) => setTimeout(r, 150));

    const messages = getOutputMessages();
    expect(messages.map((m) => m.id)).toEqual([1, 2]);
    expect(observedMaxInFlight).toBe(1);
  });

  it("should pass through server-initiated requests (e.g. sampling)", async () => {
    await createProxy();

    // Server emits a request to the client (id present, method present, untracked)
    currentChild.mockStdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "srv-1",
        method: "sampling/createMessage",
        params: { messages: [] },
      }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    const messages = getOutputMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].method).toBe("sampling/createMessage");
    expect(messages[0].id).toBe("srv-1");
  });

  it("should handle a tools/list response with no tools field", async () => {
    await createProxy();

    mockStdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    currentChild.mockStdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: 7, result: { unrelated: true } }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    const messages = getOutputMessages();
    const response = messages.find((m) => m.id === 7);
    expect(response).toBeDefined();
    expect(response!.result).toEqual({ unrelated: true });
  });

  it("should handle a large tools/call response without dropping it", async () => {
    const detector = {
      detect: vi.fn(() => ({ lang: "jpn", confidence: 1 })),
      isTargetLang: vi.fn(() => false),
    };
    const translator = {
      translate: vi.fn(async (text: string) => `EN(${text.length})`),
    };

    await createProxy(detector, translator);

    mockStdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/call", params: {} }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    const bigText = "これは大きな日本語のテキストです。".repeat(2000); // ~30k chars
    currentChild.mockStdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 99,
        result: { content: [{ type: "text", text: bigText }] },
      }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 100));

    const messages = getOutputMessages();
    const response = messages.find((m) => m.id === 99);
    expect(response).toBeDefined();
    expect((response!.result as { content: { text: string }[] }).content[0].text).toMatch(
      /^EN\(\d+\)$/,
    );
  });

  it("should ignore malformed JSON-RPC lines from the client without crashing", async () => {
    await createProxy();

    // Garbage on the way in — should be silently dropped, not forwarded
    mockStdin.write("not even json\n");
    mockStdin.write("[1,2,3]\n");
    await new Promise((r) => setTimeout(r, 50));

    // Then a valid request goes through
    mockStdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    currentChild.mockStdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    const messages = getOutputMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(1);
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

describe("stripOutputSchemas", () => {
  // Direct unit tests for the helper — exported from src/proxy/stdio.ts
  it("returns the input unchanged when not an object", async () => {
    const { stripOutputSchemas } = await import("../../src/proxy/stdio.js");
    expect(stripOutputSchemas(null)).toBeNull();
    expect(stripOutputSchemas(undefined)).toBeUndefined();
    expect(stripOutputSchemas(42)).toBe(42);
    expect(stripOutputSchemas("foo")).toBe("foo");
  });

  it("returns the input unchanged when tools is not an array", async () => {
    const { stripOutputSchemas } = await import("../../src/proxy/stdio.js");
    const input = { tools: "not-an-array" };
    expect(stripOutputSchemas(input)).toBe(input);
  });

  it("strips outputSchema from every tool while preserving siblings", async () => {
    const { stripOutputSchemas } = await import("../../src/proxy/stdio.js");
    const input = {
      tools: [
        {
          name: "a",
          description: "A",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
        },
        { name: "b", outputSchema: { x: 1 } },
      ],
      _meta: { keep: true },
    };
    const out = stripOutputSchemas(input) as {
      tools: Record<string, unknown>[];
      _meta: unknown;
    };
    expect(out.tools[0]).not.toHaveProperty("outputSchema");
    expect(out.tools[0]).toMatchObject({ name: "a", description: "A", inputSchema: { type: "object" } });
    expect(out.tools[1]).not.toHaveProperty("outputSchema");
    expect(out.tools[1]).toMatchObject({ name: "b" });
    expect(out._meta).toEqual({ keep: true });
  });

  it("leaves non-object entries inside the tools array unchanged", async () => {
    const { stripOutputSchemas } = await import("../../src/proxy/stdio.js");
    const input = { tools: [null, "weird", 42, { name: "ok", outputSchema: {} }] };
    const out = stripOutputSchemas(input) as { tools: unknown[] };
    expect(out.tools[0]).toBeNull();
    expect(out.tools[1]).toBe("weird");
    expect(out.tools[2]).toBe(42);
    expect(out.tools[3]).toEqual({ name: "ok" });
  });
});
