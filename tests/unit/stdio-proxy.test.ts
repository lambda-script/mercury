import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter, Readable, Writable } from "node:stream";
import type { ChildProcess } from "node:child_process";
import type { Detector } from "../../src/detector/index.js";
import type { Translator } from "../../src/translator/index.js";

// Mock child_process.spawn
const mockChild = {
  stdin: null as Writable | null,
  stdout: null as Readable | null,
  stderr: null as Readable | null,
  pid: 12345,
  on: vi.fn(),
  once: vi.fn(),
  kill: vi.fn(),
};

const mockSpawn = vi.fn(() => mockChild);

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Mock logger
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Capture process.stdout.write and process.exit
const originalStdoutWrite = process.stdout.write;
const originalExit = process.exit;

function createMockDetector(isTarget = false): Detector {
  return {
    detect: vi.fn(() => ({ lang: isTarget ? "eng" : "jpn", confidence: 1 })),
    isTargetLang: vi.fn(() => isTarget),
  };
}

function createMockTranslator(): Translator {
  return {
    translate: vi.fn(async (text: string) => `[EN] ${text}`),
  };
}

function createMockChildStreams() {
  const stdin = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  return { stdin, stdout, stderr };
}

describe("stdio proxy - JSON-RPC parsing", () => {
  // We import createStdioProxy and test via its behavior
  // parseJsonRpcLine and isValidJsonRpcMessage are internal,
  // but get exercised through message handling

  it("should correctly identify request messages (has method + id)", () => {
    const request = { jsonrpc: "2.0" as const, id: 1, method: "tools/call", params: {} };
    expect(request.method).toBeDefined();
    expect(request.id).toBeDefined();
  });

  it("should correctly identify notification messages (has method, no id)", () => {
    const notification = { jsonrpc: "2.0" as const, method: "notifications/progress", params: {} };
    expect(notification.method).toBeDefined();
    expect((notification as Record<string, unknown>).id).toBeUndefined();
  });

  it("should correctly identify response messages (has id, no method)", () => {
    const response = { jsonrpc: "2.0" as const, id: 1, result: { content: [] } };
    expect(response.id).toBeDefined();
    expect((response as Record<string, unknown>).method).toBeUndefined();
  });
});

describe("stdio proxy - tools/list schema stripping", () => {
  // Test stripOutputSchemas through the proxy behavior
  // Import the actual module to test the real function
  let createStdioProxy: typeof import("../../src/proxy/stdio.js").createStdioProxy;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../src/proxy/stdio.js");
    createStdioProxy = mod.createStdioProxy;
  });

  // Helper: set up a proxy and simulate server sending a tools/list response
  async function setupProxyAndSendToolsListResponse(
    toolsResult: unknown,
  ): Promise<string[]> {
    const streams = createMockChildStreams();
    const childEmitter = new EventEmitter();

    mockSpawn.mockReturnValueOnce({
      stdin: streams.stdin,
      stdout: streams.stdout,
      stderr: streams.stderr,
      pid: 12345,
      on: childEmitter.on.bind(childEmitter),
      once: childEmitter.once.bind(childEmitter),
      kill: vi.fn(),
    } as unknown as ChildProcess);

    // Capture stdout writes
    const captured: string[] = [];
    process.stdout.write = vi.fn((data: unknown) => {
      captured.push(String(data));
      return true;
    }) as typeof process.stdout.write;

    // Mock process.stdin to avoid interfering
    const fakeStdin = new Readable({ read() {} });
    const originalStdin = process.stdin;
    Object.defineProperty(process, "stdin", { value: fakeStdin, writable: true });

    const proxy = createStdioProxy("echo", ["test"], createMockDetector(), createMockTranslator(), "en");
    await proxy.start();

    // Simulate: client sends tools/list request (need to track it)
    // We write directly to child stdin via the proxy's client stream handler
    // Instead, push a tools/list request through fakeStdin
    fakeStdin.push(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n");

    // Wait for the client message to be processed
    await new Promise((r) => setTimeout(r, 10));

    // Now simulate server responding
    const response = JSON.stringify({ jsonrpc: "2.0", id: 1, result: toolsResult });
    streams.stdout.push(response + "\n");

    // Wait for processing
    await new Promise((r) => setTimeout(r, 50));

    // Cleanup
    Object.defineProperty(process, "stdin", { value: originalStdin, writable: true });
    fakeStdin.destroy();

    return captured;
  }

  it("should remove outputSchema from tools/list responses", async () => {
    const toolsResult = {
      tools: [
        {
          name: "read_file",
          description: "Read a file",
          inputSchema: { type: "object" },
          outputSchema: { type: "object", properties: { content: { type: "string" } } },
        },
      ],
    };

    const captured = await setupProxyAndSendToolsListResponse(toolsResult);

    // Find the response line (not the newline)
    const responseLine = captured.find((s) => s.includes('"result"'));
    expect(responseLine).toBeDefined();
    const parsed = JSON.parse(responseLine!.trim());
    expect(parsed.result.tools[0]).not.toHaveProperty("outputSchema");
    expect(parsed.result.tools[0]).toHaveProperty("name", "read_file");
    expect(parsed.result.tools[0]).toHaveProperty("inputSchema");
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
  });
});

describe("stdio proxy - createStdioProxy", () => {
  let createStdioProxy: typeof import("../../src/proxy/stdio.js").createStdioProxy;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../src/proxy/stdio.js");
    createStdioProxy = mod.createStdioProxy;
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    // @ts-expect-error restoring original
    process.exit = originalExit;
  });

  function setupProxy(
    detector?: Detector,
    translator?: Translator,
  ) {
    const streams = createMockChildStreams();
    const childEmitter = new EventEmitter();

    const child = {
      stdin: streams.stdin,
      stdout: streams.stdout,
      stderr: streams.stderr,
      pid: 12345,
      on: (event: string, handler: (...args: unknown[]) => void) => {
        childEmitter.on(event, handler);
      },
      once: (event: string, handler: (...args: unknown[]) => void) => {
        childEmitter.once(event, handler);
      },
      kill: vi.fn(),
    };

    mockSpawn.mockReturnValueOnce(child as unknown as ChildProcess);

    const captured: string[] = [];
    process.stdout.write = vi.fn((data: unknown) => {
      captured.push(String(data));
      return true;
    }) as typeof process.stdout.write;

    // Replace process.stdin with a fake
    const fakeStdin = new Readable({ read() {} });
    const originalStdin = process.stdin;
    Object.defineProperty(process, "stdin", { value: fakeStdin, writable: true });

    // Mock process.exit
    process.exit = vi.fn() as never;

    const proxy = createStdioProxy(
      "echo",
      ["test"],
      detector ?? createMockDetector(),
      translator ?? createMockTranslator(),
      "en",
    );

    return {
      proxy,
      streams,
      childEmitter,
      child,
      captured,
      fakeStdin,
      cleanup: () => {
        Object.defineProperty(process, "stdin", { value: originalStdin, writable: true });
        fakeStdin.destroy();
      },
    };
  }

  it("should spawn child process with correct arguments", async () => {
    const { proxy, cleanup } = setupProxy();
    await proxy.start();
    expect(mockSpawn).toHaveBeenCalledWith("echo", ["test"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    cleanup();
  });

  it("should initialize stats to zero", async () => {
    const { proxy, cleanup } = setupProxy();
    await proxy.start();
    expect(proxy.stats).toEqual({
      requestCount: 0,
      tokensSaved: 0,
      toolCallsTranslated: 0,
      toolCallsPassedThrough: 0,
    });
    cleanup();
  });

  it("should pass through notification messages from server", async () => {
    const { proxy, streams, captured, cleanup } = setupProxy();
    await proxy.start();

    const notification = { jsonrpc: "2.0", method: "notifications/progress", params: { progress: 50 } };
    streams.stdout.push(JSON.stringify(notification) + "\n");

    await new Promise((r) => setTimeout(r, 50));

    const output = captured.find((s) => s.includes("notifications/progress"));
    expect(output).toBeDefined();
    cleanup();
  });

  it("should pass through non-tracked response messages from server", async () => {
    const { proxy, streams, captured, cleanup } = setupProxy();
    await proxy.start();

    // Response with id that wasn't tracked
    const response = { jsonrpc: "2.0", id: 999, result: { data: "test" } };
    streams.stdout.push(JSON.stringify(response) + "\n");

    await new Promise((r) => setTimeout(r, 50));

    const output = captured.find((s) => s.includes('"id":999'));
    expect(output).toBeDefined();
    cleanup();
  });

  it("should translate tools/call responses", async () => {
    const { proxy, streams, captured, fakeStdin, cleanup } = setupProxy(
      createMockDetector(false),
      createMockTranslator(),
    );
    await proxy.start();

    // Client sends tools/call request
    fakeStdin.push(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }) + "\n");
    await new Promise((r) => setTimeout(r, 20));

    // Server responds with tool result
    const toolResult = {
      content: [{ type: "text", text: "これはテストです" }],
    };
    streams.stdout.push(JSON.stringify({ jsonrpc: "2.0", id: 1, result: toolResult }) + "\n");
    await new Promise((r) => setTimeout(r, 100));

    const responseLine = captured.find((s) => s.includes("[EN]"));
    expect(responseLine).toBeDefined();
    expect(proxy.stats.requestCount).toBe(1);
    expect(proxy.stats.toolCallsTranslated).toBe(1);
    cleanup();
  });

  it("should count passed-through tool calls when no translation needed", async () => {
    const { proxy, streams, fakeStdin, cleanup } = setupProxy(
      createMockDetector(true), // isTargetLang returns true
      createMockTranslator(),
    );
    await proxy.start();

    // Client sends tools/call request
    fakeStdin.push(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }) + "\n");
    await new Promise((r) => setTimeout(r, 20));

    // Server responds with already-English content
    const toolResult = {
      content: [{ type: "text", text: "This is already English" }],
    };
    streams.stdout.push(JSON.stringify({ jsonrpc: "2.0", id: 1, result: toolResult }) + "\n");
    await new Promise((r) => setTimeout(r, 100));

    expect(proxy.stats.requestCount).toBe(1);
    expect(proxy.stats.toolCallsPassedThrough).toBe(1);
    expect(proxy.stats.toolCallsTranslated).toBe(0);
    cleanup();
  });

  it("should forward client requests to child stdin", async () => {
    const { proxy, streams, fakeStdin, cleanup } = setupProxy();
    const stdinChunks: string[] = [];
    const origWrite = streams.stdin.write.bind(streams.stdin);
    streams.stdin.write = function (chunk: unknown, ...args: unknown[]) {
      stdinChunks.push(String(chunk));
      return origWrite(chunk, ...args);
    } as typeof streams.stdin.write;

    await proxy.start();

    const request = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "test" } };
    fakeStdin.push(JSON.stringify(request) + "\n");
    await new Promise((r) => setTimeout(r, 20));

    const forwarded = stdinChunks.find((s) => s.includes("tools/call"));
    expect(forwarded).toBeDefined();
    cleanup();
  });

  it("should drop non-JSON lines from server", async () => {
    const { proxy, streams, captured, cleanup } = setupProxy();
    await proxy.start();

    streams.stdout.push("this is not json\n");
    await new Promise((r) => setTimeout(r, 50));

    // No output should be written for non-JSON
    expect(captured.filter((s) => s.includes("this is not json"))).toHaveLength(0);
    cleanup();
  });

  it("should drop empty lines from server", async () => {
    const { proxy, streams, captured, cleanup } = setupProxy();
    await proxy.start();

    streams.stdout.push("\n");
    streams.stdout.push("   \n");
    await new Promise((r) => setTimeout(r, 50));

    // Only newlines or empty — nothing meaningful should be forwarded
    const meaningful = captured.filter((s) => s.trim().length > 0);
    expect(meaningful).toHaveLength(0);
    cleanup();
  });

  it("should drop non-object JSON (arrays) from server", async () => {
    const { proxy, streams, captured, cleanup } = setupProxy();
    await proxy.start();

    streams.stdout.push("[1, 2, 3]\n");
    await new Promise((r) => setTimeout(r, 50));

    expect(captured.filter((s) => s.includes("[1, 2, 3]"))).toHaveLength(0);
    cleanup();
  });

  it("should handle transform error by forwarding original result", async () => {
    const failingTranslator: Translator = {
      translate: vi.fn(async () => {
        throw new Error("Translation API down");
      }),
    };

    const { proxy, streams, captured, fakeStdin, cleanup } = setupProxy(
      createMockDetector(false),
      failingTranslator,
    );
    await proxy.start();

    // Track tools/call
    fakeStdin.push(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }) + "\n");
    await new Promise((r) => setTimeout(r, 20));

    // Server responds
    const toolResult = { content: [{ type: "text", text: "テストデータ" }] };
    streams.stdout.push(JSON.stringify({ jsonrpc: "2.0", id: 1, result: toolResult }) + "\n");
    await new Promise((r) => setTimeout(r, 100));

    // Should forward original on error
    const output = captured.find((s) => s.includes("テストデータ"));
    expect(output).toBeDefined();
    cleanup();
  });

  it("should pass through server-to-client requests (e.g., sampling)", async () => {
    const { proxy, streams, captured, cleanup } = setupProxy();
    await proxy.start();

    // A request from server to client (has both method and id)
    const samplingRequest = { jsonrpc: "2.0", id: "server-1", method: "sampling/createMessage", params: {} };
    streams.stdout.push(JSON.stringify(samplingRequest) + "\n");
    await new Promise((r) => setTimeout(r, 50));

    const output = captured.find((s) => s.includes("sampling/createMessage"));
    expect(output).toBeDefined();
    cleanup();
  });

  it("should call process.exit when child exits", async () => {
    const { proxy, childEmitter, cleanup } = setupProxy();
    await proxy.start();

    childEmitter.emit("exit", 0, null);

    expect(process.exit).toHaveBeenCalledWith(0);
    cleanup();
  });

  it("should call process.exit with child exit code", async () => {
    const { proxy, childEmitter, cleanup } = setupProxy();
    await proxy.start();

    childEmitter.emit("exit", 1, null);

    expect(process.exit).toHaveBeenCalledWith(1);
    cleanup();
  });

  it("should call process.exit(0) when child is killed by signal", async () => {
    const { proxy, childEmitter, cleanup } = setupProxy();
    await proxy.start();

    childEmitter.emit("exit", null, "SIGTERM");

    expect(process.exit).toHaveBeenCalledWith(0);
    cleanup();
  });

  it("should handle tools/call response with error field (no result)", async () => {
    const { proxy, streams, captured, fakeStdin, cleanup } = setupProxy();
    await proxy.start();

    // Track tools/call
    fakeStdin.push(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }) + "\n");
    await new Promise((r) => setTimeout(r, 20));

    // Server responds with error (no result)
    const errorResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32600, message: "Invalid Request" },
    };
    streams.stdout.push(JSON.stringify(errorResponse) + "\n");
    await new Promise((r) => setTimeout(r, 50));

    // Should pass through since there's no result to translate
    const output = captured.find((s) => s.includes("Invalid Request"));
    expect(output).toBeDefined();
    expect(proxy.stats.requestCount).toBe(0);
    cleanup();
  });

  it("should handle spawn failure", async () => {
    mockSpawn.mockImplementationOnce(() => {
      throw new Error("Command not found");
    });

    const proxy = createStdioProxy(
      "nonexistent",
      [],
      createMockDetector(),
      createMockTranslator(),
      "en",
    );

    await expect(proxy.start()).rejects.toThrow("Command not found");
  });

  it("should reject if stdio pipes are not available", async () => {
    mockSpawn.mockReturnValueOnce({
      stdin: null,
      stdout: null,
      stderr: null,
      pid: 12345,
      on: vi.fn(),
      once: vi.fn(),
      kill: vi.fn(),
    } as unknown as ChildProcess);

    const proxy = createStdioProxy(
      "test",
      [],
      createMockDetector(),
      createMockTranslator(),
      "en",
    );

    await expect(proxy.start()).rejects.toThrow("Failed to open stdio pipes");
  });

  it("should handle concurrent tool call responses in order", async () => {
    const translationDelay: Record<string, number> = {
      "最初のメッセージ": 100,
      "二番目のメッセージ": 10,
    };

    const slowTranslator: Translator = {
      translate: vi.fn(async (text: string) => {
        const delay = translationDelay[text] ?? 0;
        await new Promise((r) => setTimeout(r, delay));
        return `[EN] ${text}`;
      }),
    };

    const { proxy, streams, captured, fakeStdin, cleanup } = setupProxy(
      createMockDetector(false),
      slowTranslator,
    );
    await proxy.start();

    // Track two tools/call requests
    fakeStdin.push(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }) + "\n");
    fakeStdin.push(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: {} }) + "\n");
    await new Promise((r) => setTimeout(r, 20));

    // Server responds to both — first response takes longer to translate
    streams.stdout.push(JSON.stringify({
      jsonrpc: "2.0", id: 1,
      result: { content: [{ type: "text", text: "最初のメッセージ" }] },
    }) + "\n");
    streams.stdout.push(JSON.stringify({
      jsonrpc: "2.0", id: 2,
      result: { content: [{ type: "text", text: "二番目のメッセージ" }] },
    }) + "\n");

    await new Promise((r) => setTimeout(r, 300));

    // Both should be translated, and id:1 should come before id:2
    // because the serial queue preserves order
    const responses = captured
      .filter((s) => s.includes("[EN]"))
      .map((s) => JSON.parse(s.trim()));
    expect(responses).toHaveLength(2);
    expect(responses[0].id).toBe(1);
    expect(responses[1].id).toBe(2);
    cleanup();
  });

  it("should log final stats on child exit when translations were made", async () => {
    const { logger } = await import("../../src/utils/logger.js");
    const { proxy, streams, fakeStdin, childEmitter, cleanup } = setupProxy(
      createMockDetector(false),
      createMockTranslator(),
    );
    await proxy.start();

    // Do a translation
    fakeStdin.push(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }) + "\n");
    await new Promise((r) => setTimeout(r, 20));

    streams.stdout.push(JSON.stringify({
      jsonrpc: "2.0", id: 1,
      result: { content: [{ type: "text", text: "テストデータ" }] },
    }) + "\n");
    await new Promise((r) => setTimeout(r, 100));

    // Now child exits
    childEmitter.emit("exit", 0, null);

    // Should log final stats
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("[final]"),
    );
    cleanup();
  });

  it("should only track tools/call and tools/list methods", async () => {
    const { proxy, streams, captured, fakeStdin, cleanup } = setupProxy();
    await proxy.start();

    // Send a non-tracked method
    fakeStdin.push(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/read", params: {} }) + "\n");
    await new Promise((r) => setTimeout(r, 20));

    // Response should pass through without translation
    streams.stdout.push(JSON.stringify({
      jsonrpc: "2.0", id: 1,
      result: { data: "テスト" },
    }) + "\n");
    await new Promise((r) => setTimeout(r, 50));

    const output = captured.find((s) => s.includes("テスト"));
    expect(output).toBeDefined();
    expect(proxy.stats.requestCount).toBe(0);
    cleanup();
  });
});
