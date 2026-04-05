import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { Detector } from "../detector/index.js";
import type { Translator } from "../translator/index.js";
import { createRequestTracker, type RequestTracker } from "./tracker.js";
import { transformToolResult, formatTransformStats } from "../transform/tool-result.js";
import { logger } from "../utils/logger.js";

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

export interface StdioProxyStats {
  requestCount: number;
  tokensSaved: number;
  toolCallsTranslated: number;
  toolCallsPassedThrough: number;
}

/**
 * Remove `outputSchema` from tools/list responses to save tokens.
 * Each tool's outputSchema can be large and is not needed by the LLM.
 *
 * @param result - The tools/list response result
 * @returns The same result with outputSchema fields removed from each tool
 */
function stripOutputSchemas(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;

  const obj = result as Record<string, unknown>;
  if (!Array.isArray(obj.tools)) return result;

  const strippedTools = obj.tools.map((tool: unknown) => {
    if (!tool || typeof tool !== "object") return tool;
    const toolObj = tool as Record<string, unknown>;
    const rest = Object.fromEntries(
      Object.entries(toolObj).filter(([key]) => key !== "outputSchema"),
    );
    return rest;
  });

  return { ...obj, tools: strippedTools };
}

export interface StdioProxy {
  readonly stats: StdioProxyStats;
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

  function writeToStdout(message: JsonRpcMessage): void {
    const line = JSON.stringify(message);
    process.stdout.write(line + "\n");
  }

  function isRequest(msg: JsonRpcMessage): boolean {
    return msg.method !== undefined && msg.id !== undefined;
  }

  function isNotification(msg: JsonRpcMessage): boolean {
    return msg.method !== undefined && msg.id === undefined;
  }

  function isResponse(msg: JsonRpcMessage): boolean {
    return msg.id !== undefined && msg.method === undefined;
  }

  async function handleServerMessage(
    msg: JsonRpcMessage,
  ): Promise<void> {
    // Notification from server — pass through
    if (isNotification(msg)) {
      writeToStdout(msg);
      return;
    }

    // Response from server
    if (isResponse(msg) && msg.id !== undefined) {
      const method = tracker.take(msg.id);

      if (method === "tools/call" && msg.result !== undefined) {
        // Translate tool result content
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
          const saved = transformStats.tokensOriginal - transformStats.tokensTransformed;
          stats.tokensSaved += saved;

          if (transformStats.blocksTranslated > 0) {
            stats.toolCallsTranslated += 1;
            logger.info(`${formatTransformStats(transformStats)} | ${elapsedMs}ms`);
            logger.info(`[session] #${stats.requestCount} | total saved: ~${stats.tokensSaved} tok`);
          } else {
            stats.toolCallsPassedThrough += 1;
          }

          writeToStdout({ ...msg, result: content });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`Transform error: ${message}`);
          // On error, forward original result
          writeToStdout(msg);
        }
        return;
      }

      if (method === "tools/list" && msg.result !== undefined) {
        // Strip outputSchema to save tokens
        const stripped = stripOutputSchemas(msg.result);
        writeToStdout({ ...msg, result: stripped });
        return;
      }

      // Other responses — pass through
      writeToStdout(msg);
      return;
    }

    // Request from server to client (e.g., sampling) — pass through
    writeToStdout(msg);
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

    // Forward to child process
    const line = JSON.stringify(msg);
    childStdin.write(line + "\n");
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
          reject(new Error("Failed to open stdio pipes for child process"));
          return;
        }

        logger.info(`Started child process: ${command} ${args.join(" ")} (pid: ${child.pid})`);

        // Stream 1: stdin → child stdin (client to server)
        const clientReader = createInterface({ input: process.stdin });
        clientReader.on("line", (line) => {
          if (!line.trim()) return;
          try {
            const parsed = JSON.parse(line) as unknown;
            if (!isValidJsonRpcMessage(parsed)) {
              logger.debug("Non-object JSON from client, dropping");
              return;
            }
            if (child.stdin) {
              handleClientMessage(parsed as JsonRpcMessage, child.stdin);
            }
          } catch {
            // Not valid JSON — drop; JSON-RPC requires valid JSON
            logger.debug("Non-JSON line from client, dropping");
          }
        });

        // Stream 2: child stdout → stdout (server to client, with translation)
        // Use a serial promise queue to preserve message ordering.
        // Translation is async, so without queuing, fast responses could
        // overtake slower ones that are being translated.
        let serverQueue: Promise<void> = Promise.resolve();
        const serverReader = createInterface({ input: child.stdout });
        serverReader.on("line", (line) => {
          if (!line.trim()) return;
          serverQueue = serverQueue.then(() => {
            try {
              const parsed = JSON.parse(line) as unknown;
              if (!isValidJsonRpcMessage(parsed)) {
                logger.debug("Non-object JSON from server, dropping");
                return Promise.resolve();
              }
              return handleServerMessage(parsed as JsonRpcMessage).catch((err) => {
                logger.error(`Error handling server message: ${err instanceof Error ? err.message : String(err)}`);
                // Forward original on error
                process.stdout.write(line + "\n");
              });
            } catch {
              // Not valid JSON — drop
              logger.debug("Non-JSON line from server, dropping");
              return Promise.resolve();
            }
          });
        });

        // Stream 3: child stderr → stderr (pass through)
        child.stderr.pipe(process.stderr);

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

          process.exit(code ?? 0);
        });

        // Close child stdin when our stdin ends
        process.stdin.on("end", () => {
          child.stdin?.end();
        });

        // Signal handling — use `once` to avoid handler accumulation
        const shutdown = (sig: NodeJS.Signals) => {
          logger.info(`Received ${sig}, shutting down child process...`);
          child.kill(sig);
        };
        process.once("SIGINT", () => shutdown("SIGINT"));
        process.once("SIGTERM", () => shutdown("SIGTERM"));

        // Resolve immediately — the proxy is running
        resolve();
      });
    },
  };
}
