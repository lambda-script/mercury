import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:os";
import { createInterface } from "node:readline";
import type { Detector } from "../detector/index.js";
import type { Translator } from "../translator/index.js";
import { createRequestTracker, type RequestTracker } from "./tracker.js";
import { transformToolResult, formatTransformStats } from "../transform/tool-result.js";
import { logger } from "../utils/logger.js";

/** A JSON-RPC 2.0 message (request, response, or notification). */
export interface JsonRpcMessage {
  readonly jsonrpc: "2.0";
  readonly id?: string | number;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5000;

function isValidJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a line of text as JSON-RPC message.
 * Returns null if invalid or not a valid JSON-RPC message.
 */
function parseJsonRpcLine(line: string): JsonRpcMessage | null {
  if (!line.trim()) return null;
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!isValidJsonRpcMessage(parsed)) {
      logger.debug("Non-object JSON, dropping");
      return null;
    }
    return parsed as JsonRpcMessage;
  } catch {
    logger.debug("Non-JSON line, dropping");
    return null;
  }
}

/** Serialize a JSON-RPC message and write it to a stream as a single line. */
function writeJsonRpc(stream: NodeJS.WritableStream, msg: JsonRpcMessage): void {
  stream.write(JSON.stringify(msg) + "\n");
}

function isRequest(msg: JsonRpcMessage): boolean {
  return msg.method !== undefined && msg.id !== undefined;
}

function isResponse(msg: JsonRpcMessage): boolean {
  return msg.id !== undefined && msg.method === undefined;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Cumulative statistics for the stdio proxy session. */
export interface StdioProxyStats {
  /** Total tool call responses processed. */
  requestCount: number;
  /** Estimated total tokens saved by translation across all tool calls. */
  tokensSaved: number;
  /** Number of tool calls where translation was applied. */
  toolCallsTranslated: number;
  /** Number of tool calls where text was already in target language (no translation needed). */
  toolCallsPassedThrough: number;
}

/**
 * Remove `outputSchema` from tools/list responses to save tokens.
 * Each tool's outputSchema can be large and is not needed by the LLM.
 *
 * @param result - The tools/list response result
 * @returns The same result with outputSchema fields removed from each tool
 */
export function stripOutputSchemas(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;

  const obj = result as Record<string, unknown>;
  if (!Array.isArray(obj.tools)) return result;

  const strippedTools = obj.tools.map((tool: unknown) => {
    if (!tool || typeof tool !== "object") return tool;
    const { outputSchema: _omit, ...rest } = tool as Record<string, unknown>;
    void _omit;
    return rest;
  });

  return { ...obj, tools: strippedTools };
}

/** MCP stdio proxy that intercepts and translates tool results. */
export interface StdioProxy {
  /** Cumulative session statistics. */
  readonly stats: StdioProxyStats;
  /** Start the proxy. Spawns the child process and begins intercepting messages. */
  start(): Promise<void>;
}

/**
 * Create a stdio proxy that wraps an MCP server, intercepting and translating tool results.
 *
 * The proxy spawns the MCP server as a child process, pipes stdin/stdout/stderr, and intercepts
 * JSON-RPC responses. Tool call results are translated to the target language before being
 * returned to the client.
 *
 * @param command - The MCP server command to execute (e.g., "npx")
 * @param args - Arguments to pass to the command (e.g., ["your-mcp-server"])
 * @param detector - Language detector for identifying non-target-language text
 * @param translator - Translation backend (google-free or haiku)
 * @param targetLang - Target language for translation (e.g., "en")
 * @returns A stdio proxy instance with a start() method and stats tracking
 */
export function createStdioProxy(
  command: string,
  args: readonly string[],
  detector: Detector,
  translator: Translator,
  targetLang: string,
): StdioProxy {
  const tracker: RequestTracker = createRequestTracker();
  const stats: StdioProxyStats = {
    requestCount: 0,
    tokensSaved: 0,
    toolCallsTranslated: 0,
    toolCallsPassedThrough: 0,
  };

  // Promise queue for serializing async server message handling.
  // Hoisted here so the exit handler can drain in-flight translations.
  let serverQueue: Promise<void> = Promise.resolve();

  /**
   * Translate a tools/call response and write it to stdout.
   * On any failure, the original message is forwarded unchanged so the
   * client never sees a dropped response.
   */
  async function handleToolCallResponse(msg: JsonRpcMessage): Promise<void> {
    if (msg.result === undefined) {
      writeJsonRpc(process.stdout, msg);
      return;
    }

    stats.requestCount += 1;
    const startTime = Date.now();

    try {
      const { content, stats: transformStats } = await transformToolResult(
        msg.result,
        detector,
        translator,
        targetLang,
      );

      const elapsedMs = Date.now() - startTime;
      stats.tokensSaved += transformStats.tokensOriginal - transformStats.tokensTransformed;

      if (transformStats.blocksTranslated > 0) {
        stats.toolCallsTranslated += 1;
        logger.info(`${formatTransformStats(transformStats)} | ${elapsedMs}ms`);
        logger.info(`[session] #${stats.requestCount} | total saved: ~${stats.tokensSaved} tok`);
      } else {
        stats.toolCallsPassedThrough += 1;
      }

      writeJsonRpc(process.stdout, { ...msg, result: content });
    } catch (err) {
      logger.error(`Transform error: ${errMsg(err)}`);
      writeJsonRpc(process.stdout, msg);
    }
  }

  async function handleServerMessage(msg: JsonRpcMessage): Promise<void> {
    // Notifications and server-initiated requests pass through unchanged.
    if (!isResponse(msg) || msg.id === undefined) {
      writeJsonRpc(process.stdout, msg);
      return;
    }

    const method = tracker.take(msg.id);

    if (method === "tools/call") {
      await handleToolCallResponse(msg);
      return;
    }

    if (method === "tools/list" && msg.result !== undefined) {
      writeJsonRpc(process.stdout, { ...msg, result: stripOutputSchemas(msg.result) });
      return;
    }

    writeJsonRpc(process.stdout, msg);
  }

  function handleClientMessage(
    msg: JsonRpcMessage,
    childStdin: NodeJS.WritableStream,
  ): void {
    // Track requests so we know which responses to transform
    if (isRequest(msg) && msg.id !== undefined && msg.method !== undefined) {
      if (msg.method === "tools/call" || msg.method === "tools/list") {
        tracker.track(msg.id, msg.method);
      }
    }

    writeJsonRpc(childStdin, msg);
  }

  /** Setup stream from client (stdin) to child process. */
  function setupClientStream(child: ChildProcess): void {
    const clientReader = createInterface({ input: process.stdin });
    clientReader.on("line", (line) => {
      const msg = parseJsonRpcLine(line);
      if (msg && child.stdin) {
        handleClientMessage(msg, child.stdin);
      }
    });

    // Close child stdin when our stdin ends
    process.stdin.on("end", () => {
      child.stdin?.end();
    });
  }

  /**
   * Setup stream from child process (stdout) to client, with translation.
   * Uses a serial promise queue to preserve message ordering during async translation.
   */
  function setupServerStream(child: ChildProcess): void {
    const serverReader = createInterface({ input: child.stdout! });

    serverReader.on("line", (line) => {
      serverQueue = serverQueue.then(async () => {
        const msg = parseJsonRpcLine(line);
        if (!msg) return;
        try {
          await handleServerMessage(msg);
        } catch (err) {
          logger.error(`Error handling server message: ${errMsg(err)}`);
          // Forward original on error so the client is not left hanging.
          process.stdout.write(line + "\n");
        }
      });
    });
  }

  /**
   * Wait for the in-flight translation queue to drain, capped at the
   * graceful-shutdown timeout. Resolves either way — never throws.
   */
  function drainServerQueue(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        logger.warn("In-flight translations did not complete, exiting");
        resolve();
      }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
      timer.unref();

      serverQueue.finally(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Compute the final exit code from a child's exit (code, signal). */
  function computeExitCode(code: number | null, signal: NodeJS.Signals | null): number {
    if (code !== null) return code;
    if (signal) {
      const sigNum = (constants.signals as Record<string, number>)[signal] ?? 0;
      return 128 + sigNum;
    }
    return 1;
  }

  /** Setup process lifecycle handlers: error, exit, signals. */
  function setupProcessLifecycle(child: ChildProcess, reject: (err: Error) => void): void {
    child.on("error", (err) => {
      logger.error(`Child process error: ${err.message}`);
      reject(err);
    });

    child.on("exit", (code, signal) => {
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      logger.info(`Child process exited (${reason})`);

      if (stats.toolCallsTranslated > 0) {
        logger.info(
          `[final] Translated ${stats.toolCallsTranslated} tool calls | ` +
          `total saved: ~${stats.tokensSaved} tok`,
        );
      }

      const exitCode = computeExitCode(code, signal);
      drainServerQueue().then(() => process.exit(exitCode));
    });

    let shutdownInProgress = false;
    const shutdown = (sig: NodeJS.Signals) => {
      if (shutdownInProgress) return;
      shutdownInProgress = true;

      logger.info(`Received ${sig}, attempting graceful shutdown...`);

      // Forward the signal so the child can shut down gracefully.
      try {
        child.kill(sig);
      } catch {
        // Child may already be dead.
      }

      // Also close stdin to signal the child to finish.
      child.stdin?.end();

      // Force kill if the child is still alive after the timeout.
      const forceKillTimer = setTimeout(() => {
        logger.warn(`Child did not exit after ${GRACEFUL_SHUTDOWN_TIMEOUT_MS}ms, force killing...`);
        child.kill("SIGKILL");
      }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
      forceKillTimer.unref();

      child.once("exit", () => clearTimeout(forceKillTimer));
    };

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  }

  return {
    stats,

    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        let child: ChildProcess;

        try {
          child = spawn(command, args as string[], {
            stdio: ["pipe", "pipe", "pipe"],
            env: process.env,
          });
        } catch (err) {
          reject(err);
          return;
        }

        if (!child.stdin || !child.stdout || !child.stderr) {
          reject(new Error(
            `Failed to open stdio pipes for child process '${command}'. ` +
            `Verify the command exists and is executable.`
          ));
          return;
        }

        logger.info(`Started child process: ${command} ${args.join(" ")} (pid: ${child.pid})`);

        setupClientStream(child);
        setupServerStream(child);
        child.stderr.pipe(process.stderr);

        setupProcessLifecycle(child, reject);

        // Resolve immediately — the proxy is running.
        resolve();
      });
    },
  };
}
