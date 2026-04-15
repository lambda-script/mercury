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

function isValidJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a line of text as JSON-RPC message.
 * Returns null if invalid or not a valid JSON-RPC message.
 */
function parseJsonRpcLine(line: string): JsonRpcMessage | null {
  // Skip empty / whitespace-only lines without allocating a trimmed copy.
  let i = 0;
  const len = line.length;
  while (i < len) {
    const ch = line.charCodeAt(i);
    if (ch !== 0x20 && ch !== 0x09 && ch !== 0x0a && ch !== 0x0d) break;
    i++;
  }
  if (i === len) return null;

  try {
    const parsed = JSON.parse(line) as unknown;
    if (!isValidJsonRpcMessage(parsed)) {
      logger.debug("Non-object JSON, dropping");
      return null;
    }
    return parsed;
  } catch {
    logger.debug("Non-JSON line, dropping");
    return null;
  }
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
    const { outputSchema: _drop, ...rest } = tool as Record<string, unknown>;
    void _drop;
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
 * A FIFO queue that runs async tasks one at a time.
 *
 * Used to preserve message ordering while individual tasks (translations)
 * are async. Errors in tasks are caught and logged, never propagated, so
 * one failing task does not poison subsequent ones.
 */
interface SerialQueue {
  /** Append a task. Resolves immediately; the task runs in FIFO order. */
  enqueue(task: () => Promise<void>): void;
  /** Resolves when all currently queued tasks have settled. */
  drain(): Promise<void>;
}

function createSerialQueue(label: string): SerialQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    enqueue(task) {
      tail = tail.then(task).catch((err) => {
        logger.error(
          `[${label}] task error: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    },
    drain() {
      return tail;
    },
  };
}

const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5000;

/**
 * Compute the exit code from child exit info.
 * Mirrors shell convention: 128+signal for signal kills, child code otherwise.
 */
function computeExitCode(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  if (signal !== null) {
    const sigNum = (constants.signals as Record<string, number>)[signal] ?? 0;
    return 128 + sigNum;
  }
  return 1;
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

  // Serializes async server message handling so responses keep FIFO order.
  // Hoisted so the exit handler can drain in-flight translations before exit.
  const serverQueue = createSerialQueue("server-queue");

  function writeMessage(message: JsonRpcMessage): void {
    try {
      process.stdout.write(JSON.stringify(message) + "\n");
    } catch (err) {
      // EPIPE if client closed stdout — log and continue rather than crash.
      logger.warn(
        `Failed to write to stdout: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Translate a tools/call response, falling back to the original on error. */
  async function handleToolCallResponse(msg: JsonRpcMessage): Promise<void> {
    if (msg.result === undefined) {
      writeMessage(msg);
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

      writeMessage({ ...msg, result: content });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Transform error: ${message}`);
      writeMessage(msg); // Forward original on error
    }
  }

  /** Strip outputSchema from a tools/list response. */
  function handleToolListResponse(msg: JsonRpcMessage): void {
    if (msg.result === undefined) {
      writeMessage(msg);
      return;
    }
    writeMessage({ ...msg, result: stripOutputSchemas(msg.result) });
  }

  /** Dispatch a server-originated message. */
  async function handleServerMessage(msg: JsonRpcMessage): Promise<void> {
    const isResponse = msg.id !== undefined && msg.method === undefined;
    if (!isResponse) {
      // Notification, request from server (e.g. sampling), or anything else: pass through.
      writeMessage(msg);
      return;
    }

    const method = tracker.take(msg.id!);
    switch (method) {
      case "tools/call":
        await handleToolCallResponse(msg);
        return;
      case "tools/list":
        handleToolListResponse(msg);
        return;
      default:
        writeMessage(msg);
    }
  }

  function handleClientMessage(msg: JsonRpcMessage, childStdin: NodeJS.WritableStream): void {
    // Track requests so we know which responses to transform.
    if (msg.id !== undefined && msg.method !== undefined) {
      if (msg.method === "tools/call" || msg.method === "tools/list") {
        tracker.track(msg.id, msg.method);
      }
    }
    // Forward to child process. Catch EPIPE so a dead child doesn't crash us.
    try {
      childStdin.write(JSON.stringify(msg) + "\n");
    } catch (err) {
      logger.warn(
        `Failed to write to child stdin: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Setup stream from client (stdin) to child process. */
  function setupClientStream(child: ChildProcess): void {
    const clientReader = createInterface({ input: process.stdin });
    // readline re-emits input stream errors on the interface itself —
    // attach a handler so a process.stdin error doesn't crash us.
    clientReader.on("error", (err) => {
      logger.warn(`Client readline error: ${err.message}`);
    });
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
   * Setup stream from child process (stdout) to client.
   * Async work is enqueued onto a serial queue so messages stay in FIFO order.
   */
  function setupServerStream(child: ChildProcess): void {
    const serverReader = createInterface({ input: child.stdout! });
    serverReader.on("error", (err) => {
      logger.warn(`Server readline error: ${err.message}`);
    });
    serverReader.on("line", (line) => {
      serverQueue.enqueue(async () => {
        const msg = parseJsonRpcLine(line);
        if (!msg) return;
        try {
          await handleServerMessage(msg);
        } catch (err) {
          logger.error(
            `Error handling server message: ${err instanceof Error ? err.message : String(err)}`,
          );
          // Forward original on error so the client still sees something.
          process.stdout.write(line + "\n");
        }
      });
    });
  }

  /** Drain the queue, then exit. Falls back to a hard exit on timeout. */
  function drainAndExit(exitCode: number): void {
    const drainTimeout = setTimeout(() => {
      logger.warn("In-flight translations did not complete, exiting");
      process.exit(exitCode);
    }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
    drainTimeout.unref();

    serverQueue
      .drain()
      .then(() => {
        clearTimeout(drainTimeout);
        process.exit(exitCode);
      })
      .catch(() => {
        process.exit(exitCode);
      });
  }

  /** Setup process lifecycle handlers: error, exit, signals. */
  function setupProcessLifecycle(child: ChildProcess, reject: (err: Error) => void): void {
    child.on("error", (err) => {
      const errno = (err as NodeJS.ErrnoException).code;
      if (errno === "ENOENT") {
        logger.error(
          `Command not found: '${command}'. ` +
          `Verify the command is installed and on your PATH, or use an absolute path in .mcp.json.`,
        );
      } else if (errno === "EACCES") {
        logger.error(
          `Permission denied: '${command}'. ` +
          `Check that the file is executable (chmod +x).`,
        );
      } else {
        logger.error(`Child process error: ${err.message}`);
      }
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

      drainAndExit(computeExitCode(code, signal));
    });

    let shutdownInProgress = false;
    const shutdown = (sig: NodeJS.Signals) => {
      if (shutdownInProgress) return;
      shutdownInProgress = true;

      logger.info(`Received ${sig}, attempting graceful shutdown...`);

      // Forward signal to child so it can shut down gracefully.
      try {
        child.kill(sig);
      } catch {
        // Child may already be dead.
      }
      child.stdin?.end();

      // Force kill if child does not exit in time.
      const forceKillTimer = setTimeout(() => {
        logger.warn(
          `Child did not exit after ${GRACEFUL_SHUTDOWN_TIMEOUT_MS}ms, force killing...`,
        );
        child.kill("SIGKILL");
      }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
      forceKillTimer.unref();

      child.once("exit", () => {
        clearTimeout(forceKillTimer);
      });
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
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }

        if (!child.stdin || !child.stdout || !child.stderr) {
          reject(
            new Error(
              `Failed to open stdio pipes for child process '${command}'. ` +
                `Verify the command exists and is executable.`,
            ),
          );
          return;
        }

        logger.info(
          `Started child process: ${command} ${args.join(" ")} (pid: ${child.pid})`,
        );

        // Attach error listeners to all child stdio streams. Without these,
        // an EPIPE (e.g. child crashes mid-write) becomes an unhandled
        // 'error' event and terminates the proxy.
        child.stdin.on("error", (err) => {
          logger.warn(`Child stdin error: ${err.message}`);
        });
        child.stdout.on("error", (err) => {
          logger.warn(`Child stdout error: ${err.message}`);
        });
        child.stderr.on("error", (err) => {
          logger.warn(`Child stderr error: ${err.message}`);
        });

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
