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
