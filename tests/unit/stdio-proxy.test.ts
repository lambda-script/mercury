import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const {
  mockSpawn,
  mockCreateInterface,
  mockTransformToolResult,
  mockFormatTransformStats,
} = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockCreateInterface: vi.fn(),
  mockTransformToolResult: vi.fn(),
  mockFormatTransformStats: vi.fn(() => "[stats]"),
}));

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

vi.mock("node:readline", () => ({
  createInterface: mockCreateInterface,
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/transform/tool-result.js", () => ({
  transformToolResult: mockTransformToolResult,
  formatTransformStats: mockFormatTransformStats,
}));

import { createStdioProxy } from "../../src/proxy/stdio.js";
import type { Detector } from "../../src/detector/index.js";
import type { Translator } from "../../src/translator/index.js";

function createMockDetector(): Detector {
  return {
    detect: vi.fn(() => ({ lang: "jpn", confidence: 1 })),
    isTargetLang: vi.fn(() => false),
  };
}

function createMockTranslator(): Translator {
  return {
    translate: vi.fn(async (text: string) => `[EN] ${text}`),
  };
}

function createMockChild() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 12345,
    kill: vi.fn(),
  });
  return child;
}

async function flushPromises() {
  await new Promise((r) => setTimeout(r, 10));
}

function makeProxy() {
  return createStdioProxy(
    "node",
    ["server.js"],
    createMockDetector(),
    createMockTranslator(),
    "en",
  );
}

describe("createStdioProxy", () => {
  let mockChild: ReturnType<typeof createMockChild>;
  let clientRL: EventEmitter;
  let serverRL: EventEmitter;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let stdinOnSpy: ReturnType<typeof vi.spyOn>;
  let processOnceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockChild = createMockChild();
    mockSpawn.mockReturnValue(mockChild);

    clientRL = new EventEmitter();
    serverRL = new EventEmitter();
    let rlCount = 0;
    mockCreateInterface.mockImplementation(() => {
      return ++rlCount === 1 ? clientRL : serverRL;
    });

    // Prevent pipe from attaching too many listeners on the real stderr
    vi.spyOn(mockChild.stderr, "pipe").mockReturnValue(mockChild.stderr);

    stdoutWriteSpy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);
    processExitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    stdinOnSpy = vi
      .spyOn(process.stdin, "on")
      .mockReturnValue(process.stdin);
    processOnceSpy = vi
      .spyOn(process, "once")
      .mockReturnValue(process);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    processExitSpy.mockRestore();
    stdinOnSpy.mockRestore();
    processOnceSpy.mockRestore();
  });

  function getStdoutLines(): string[] {
    return stdoutWriteSpy.mock.calls.map((c) => c[0] as string);
  }

  // --- Spawn and initialization ---

  it("should spawn the child process with correct arguments", async () => {
    const proxy = makeProxy();
    await proxy.start();

    expect(mockSpawn).toHaveBeenCalledWith("node", ["server.js"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
  });

  it("should reject if spawn throws", async () => {
    mockSpawn.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const proxy = makeProxy();
    await expect(proxy.start()).rejects.toThrow("ENOENT");
  });

  it("should reject if child has no stdio pipes", async () => {
    const badChild = Object.assign(new EventEmitter(), {
      stdin: null,
      stdout: null,
      stderr: null,
      pid: 123,
    });
    mockSpawn.mockReturnValue(badChild);

    const proxy = makeProxy();
    await expect(proxy.start()).rejects.toThrow("Failed to open stdio pipes");
  });

  it("should initialize stats at zero", () => {
    const proxy = makeProxy();
    expect(proxy.stats.requestCount).toBe(0);
    expect(proxy.stats.tokensSaved).toBe(0);
    expect(proxy.stats.toolCallsTranslated).toBe(0);
    expect(proxy.stats.toolCallsPassedThrough).toBe(0);
  });

  // --- Client → child forwarding ---

  it("should forward client requests to child stdin", async () => {
    const proxy = makeProxy();
    await proxy.start();

    const chunks: Buffer[] = [];
    mockChild.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));

    const request = { jsonrpc: "2.0", id: 1, method: "tools/call", params: {} };
    clientRL.emit("line", JSON.stringify(request));

    await flushPromises();
    const written = Buffer.concat(chunks).toString();
    expect(written).toContain('"method":"tools/call"');
  });

  it("should forward client notifications to child", async () => {
    const proxy = makeProxy();
    await proxy.start();

    const chunks: Buffer[] = [];
    mockChild.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));

    clientRL.emit(
      "line",
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    );

    await flushPromises();
    const written = Buffer.concat(chunks).toString();
    expect(written).toContain("notifications/initialized");
  });

  it("should drop invalid JSON from client", async () => {
    const proxy = makeProxy();
    await proxy.start();

    const chunks: Buffer[] = [];
    mockChild.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));

    clientRL.emit("line", "not valid json");
    clientRL.emit("line", "");
    clientRL.emit("line", "   ");

    await flushPromises();
    expect(chunks.length).toBe(0);
  });

  it("should not track non-tools requests", async () => {
    const proxy = makeProxy();
    await proxy.start();

    clientRL.emit(
      "line",
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/read", params: {} }),
    );
    serverRL.emit(
      "line",
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { contents: [] } }),
    );

    await flushPromises();
    expect(mockTransformToolResult).not.toHaveBeenCalled();
    expect(getStdoutLines().length).toBe(1);
  });

  // --- Server → client: tools/call translation ---

  it("should translate tools/call responses", async () => {
    mockTransformToolResult.mockResolvedValue({
      content: { content: [{ type: "text", text: "translated" }] },
      stats: {
        blocksTranslated: 1,
        blocksSkipped: 0,
        charsOriginal: 20,
        charsTransformed: 15,
        tokensOriginal: 10,
        tokensTransformed: 5,
        detectedLang: "jpn",
      },
    });

    const proxy = makeProxy();
    await proxy.start();

    clientRL.emit(
      "line",
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }),
    );
    serverRL.emit(
      "line",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "テスト" }] },
      }),
    );

    await flushPromises();

    const output = getStdoutLines().find((s) => s.includes("translated"));
    expect(output).toBeDefined();
    expect(proxy.stats.toolCallsTranslated).toBe(1);
    expect(proxy.stats.tokensSaved).toBe(5);
    expect(proxy.stats.requestCount).toBe(1);
  });

  it("should count passed-through tool calls with 0 blocks translated", async () => {
    mockTransformToolResult.mockResolvedValue({
      content: { content: [{ type: "text", text: "English" }] },
      stats: {
        blocksTranslated: 0,
        blocksSkipped: 1,
        charsOriginal: 0,
        charsTransformed: 0,
        tokensOriginal: 0,
        tokensTransformed: 0,
        detectedLang: null,
      },
    });

    const proxy = makeProxy();
    await proxy.start();

    clientRL.emit(
      "line",
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }),
    );
    serverRL.emit(
      "line",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "English" }] },
      }),
    );

    await flushPromises();

    expect(proxy.stats.toolCallsPassedThrough).toBe(1);
    expect(proxy.stats.toolCallsTranslated).toBe(0);
  });

  it("should forward original on transform error", async () => {
    mockTransformToolResult.mockRejectedValue(new Error("Translation failed"));

    const proxy = makeProxy();
    await proxy.start();

    clientRL.emit(
      "line",
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }),
    );
    serverRL.emit(
      "line",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "original" }] },
      }),
    );

    await flushPromises();

    const output = getStdoutLines().find((s) => s.includes("original"));
    expect(output).toBeDefined();
  });

  it("should not transform tools/call error responses (no result)", async () => {
    const proxy = makeProxy();
    await proxy.start();

    clientRL.emit(
      "line",
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }),
    );
    serverRL.emit(
      "line",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32600, message: "Invalid" },
      }),
    );

    await flushPromises();

    expect(mockTransformToolResult).not.toHaveBeenCalled();
    const output = getStdoutLines().find((s) => s.includes("Invalid"));
    expect(output).toBeDefined();
  });

  // --- Server → client: tools/list stripping ---

  it("should strip outputSchema from tools/list responses", async () => {
    const proxy = makeProxy();
    await proxy.start();

    clientRL.emit(
      "line",
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    );
    serverRL.emit(
      "line",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          tools: [
            { name: "read_file", inputSchema: {}, outputSchema: { type: "object" } },
            { name: "write_file", outputSchema: { type: "object" } },
          ],
        },
      }),
    );

    await flushPromises();

    const toolsOutput = getStdoutLines().find((s) => s.includes("read_file"));
    expect(toolsOutput).toBeDefined();
    const parsed = JSON.parse(toolsOutput!.trim());
    expect(parsed.result.tools[0]).not.toHaveProperty("outputSchema");
    expect(parsed.result.tools[0]).toHaveProperty("name", "read_file");
    expect(parsed.result.tools[1]).not.toHaveProperty("outputSchema");
  });

  it("should pass through tools/list with non-tools result shape", async () => {
    const proxy = makeProxy();
    await proxy.start();

    clientRL.emit(
      "line",
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    );
    serverRL.emit(
      "line",
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { something: "else" } }),
    );

    await flushPromises();

    const parsed = JSON.parse(getStdoutLines()[0].trim());
    expect(parsed.result.something).toBe("else");
  });

  it("should handle tools/list with null result", async () => {
    const proxy = makeProxy();
    await proxy.start();

    clientRL.emit(
      "line",
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    );
    serverRL.emit(
      "line",
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }),
    );

    await flushPromises();

    expect(getStdoutLines().length).toBe(1);
  });

  it("should handle non-object tool entries in tools/list", async () => {
    const proxy = makeProxy();
    await proxy.start();

    clientRL.emit(
      "line",
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    );
    serverRL.emit(
      "line",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          tools: [null, "not-object", { name: "tool", outputSchema: {} }],
        },
      }),
    );

    await flushPromises();

    const parsed = JSON.parse(getStdoutLines()[0].trim());
    expect(parsed.result.tools[0]).toBeNull();
    expect(parsed.result.tools[1]).toBe("not-object");
    expect(parsed.result.tools[2]).not.toHaveProperty("outputSchema");
    expect(parsed.result.tools[2]).toHaveProperty("name", "tool");
  });

  // --- Server → client: pass-through ---

  it("should pass through server notifications", async () => {
    const proxy = makeProxy();
    await proxy.start();

    serverRL.emit(
      "line",
      JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: { progress: 50 },
      }),
    );

    await flushPromises();

    const output = getStdoutLines().find((s) => s.includes("notifications/progress"));
    expect(output).toBeDefined();
  });

  it("should pass through untracked responses", async () => {
    const proxy = makeProxy();
    await proxy.start();

    serverRL.emit(
      "line",
      JSON.stringify({ jsonrpc: "2.0", id: 999, result: { data: "hello" } }),
    );

    await flushPromises();

    const output = getStdoutLines().find((s) => s.includes('"id":999'));
    expect(output).toBeDefined();
  });

  it("should pass through server-to-client requests (e.g., sampling)", async () => {
    const proxy = makeProxy();
    await proxy.start();

    // Message with both method and id from server → not notification, not response
    serverRL.emit(
      "line",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sampling/createMessage",
        params: {},
      }),
    );

    await flushPromises();

    const output = getStdoutLines().find((s) => s.includes("sampling/createMessage"));
    expect(output).toBeDefined();
  });

  // --- Server: invalid input ---

  it("should drop invalid JSON from server", async () => {
    const proxy = makeProxy();
    await proxy.start();

    serverRL.emit("line", "not json");
    serverRL.emit("line", "");
    serverRL.emit("line", "   ");

    await flushPromises();

    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });

  it("should drop non-object JSON from server (arrays, primitives)", async () => {
    const proxy = makeProxy();
    await proxy.start();

    serverRL.emit("line", "[1, 2, 3]");
    serverRL.emit("line", '"just a string"');
    serverRL.emit("line", "42");

    await flushPromises();

    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });

  // --- Concurrent message ordering ---

  it("should process server messages in order via serial queue", async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    mockTransformToolResult.mockImplementation(
      () => new Promise((r) => resolvers.push(r)),
    );

    const proxy = makeProxy();
    await proxy.start();

    clientRL.emit(
      "line",
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }),
    );
    clientRL.emit(
      "line",
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: {} }),
    );

    serverRL.emit(
      "line",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "first" }] },
      }),
    );
    serverRL.emit(
      "line",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: { content: [{ type: "text", text: "second" }] },
      }),
    );

    await flushPromises();

    const stats = {
      blocksTranslated: 1,
      blocksSkipped: 0,
      charsOriginal: 5,
      charsTransformed: 5,
      tokensOriginal: 2,
      tokensTransformed: 2,
      detectedLang: "jpn",
    };

    // Resolve first request
    resolvers[0]({
      content: { content: [{ type: "text", text: "first-translated" }] },
      stats,
    });
    await flushPromises();

    // First output should be from id:1
    expect(getStdoutLines()[0]).toContain("first-translated");
  });

  // --- Process lifecycle ---

  it("should exit when child process exits with code", async () => {
    const proxy = makeProxy();
    await proxy.start();

    mockChild.emit("exit", 1, null);
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it("should exit with 0 when child exits with null code (signal)", async () => {
    const proxy = makeProxy();
    await proxy.start();

    mockChild.emit("exit", null, "SIGTERM");
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it("should log final stats on exit when translations occurred", async () => {
    const { logger } = await import("../../src/utils/logger.js");

    mockTransformToolResult.mockResolvedValue({
      content: { content: [{ type: "text", text: "translated" }] },
      stats: {
        blocksTranslated: 1,
        blocksSkipped: 0,
        charsOriginal: 20,
        charsTransformed: 15,
        tokensOriginal: 10,
        tokensTransformed: 5,
        detectedLang: "jpn",
      },
    });

    const proxy = makeProxy();
    await proxy.start();

    clientRL.emit(
      "line",
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }),
    );
    serverRL.emit(
      "line",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "テスト" }] },
      }),
    );
    await flushPromises();

    mockChild.emit("exit", 0, null);

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("[final]"));
  });

  it("should handle child process error event", async () => {
    const { logger } = await import("../../src/utils/logger.js");

    const proxy = makeProxy();
    await proxy.start();

    mockChild.emit("error", new Error("spawn failed"));

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("spawn failed"),
    );
  });

  // --- Graceful shutdown ---

  it("should initiate graceful shutdown on SIGINT", async () => {
    const proxy = makeProxy();
    await proxy.start();

    const sigintCall = processOnceSpy.mock.calls.find(
      (c) => c[0] === "SIGINT",
    );
    expect(sigintCall).toBeDefined();

    sigintCall![1]();

    // child.stdin should be ended
    expect(mockChild.stdin.writableEnded).toBe(true);
  });

  it("should ignore duplicate shutdown signals", async () => {
    const proxy = makeProxy();
    await proxy.start();

    const sigintCall = processOnceSpy.mock.calls.find(
      (c) => c[0] === "SIGINT",
    );
    const sigtermCall = processOnceSpy.mock.calls.find(
      (c) => c[0] === "SIGTERM",
    );

    sigintCall![1]();
    sigtermCall![1]();

    // kill should not have been called yet (only after timeout)
    expect(mockChild.kill).not.toHaveBeenCalled();
  });

  it("should force kill child after shutdown timeout", async () => {
    vi.useFakeTimers();

    const proxy = makeProxy();
    await proxy.start();

    const sigintCall = processOnceSpy.mock.calls.find(
      (c) => c[0] === "SIGINT",
    );
    sigintCall![1]();

    vi.advanceTimersByTime(5001);

    expect(mockChild.kill).toHaveBeenCalledWith("SIGKILL");

    vi.useRealTimers();
  });

  it("should clear force kill timer if child exits gracefully", async () => {
    vi.useFakeTimers();

    const proxy = makeProxy();
    await proxy.start();

    const sigintCall = processOnceSpy.mock.calls.find(
      (c) => c[0] === "SIGINT",
    );
    sigintCall![1]();

    // Child exits before timeout
    mockChild.emit("exit", 0, null);

    vi.advanceTimersByTime(5001);

    // Should NOT have force killed
    expect(mockChild.kill).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  // --- stdin end handler ---

  it("should register stdin end handler to close child stdin", async () => {
    const proxy = makeProxy();
    await proxy.start();

    const endCall = stdinOnSpy.mock.calls.find((c) => c[0] === "end");
    expect(endCall).toBeDefined();
  });
});
