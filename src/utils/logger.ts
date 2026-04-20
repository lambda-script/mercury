import { appendFileSync } from "node:fs";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.MERCURY_LOG_LEVEL as LogLevel) ?? "info";
const logFile: string | undefined = process.env.MERCURY_LOG_FILE || undefined;

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

function write(formatted: string): void {
  const line = formatted + "\n";
  if (logFile) {
    try {
      appendFileSync(logFile, line);
    } catch {
      // If file write fails, fall back to stderr
      process.stderr.write(line);
    }
  } else {
    process.stderr.write(line);
  }
}

/** Extract a message string from an unknown thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause ? ` (cause: ${err.cause})` : "";
    return `${err.message}${cause}`;
  }
  return String(err);
}

/**
 * Process-wide logger for Mercury.
 *
 * Writes to stderr by default to keep stdout clean for JSON-RPC traffic.
 * Set `MERCURY_LOG_FILE` to redirect output to a file (useful when stderr is
 * swallowed by the MCP host, e.g. Claude Code). Set `MERCURY_LOG_LEVEL` to
 * `debug`, `info`, `warn`, or `error` (default: `info`).
 *
 * Log level and file destination are read from environment variables once at
 * module load time, so changing them at runtime has no effect.
 */
export const logger = {
  debug(message: string): void {
    if (shouldLog("debug")) {
      write(formatMessage("debug", message));
    }
  },
  info(message: string): void {
    if (shouldLog("info")) {
      write(formatMessage("info", message));
    }
  },
  warn(message: string): void {
    if (shouldLog("warn")) {
      write(formatMessage("warn", message));
    }
  },
  error(message: string): void {
    if (shouldLog("error")) {
      write(formatMessage("error", message));
    }
  },
};
