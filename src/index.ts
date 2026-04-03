import { loadConfig } from "./config.js";
import type { Config } from "./config.js";
import { createFrancDetector } from "./detector/franc.js";
import { createGoogleFreeTranslator } from "./translator/google-free.js";
import { createHaikuTranslator } from "./translator/haiku.js";
import type { Translator } from "./translator/index.js";
import { createHttpProxy } from "./proxy/http.js";
import { logger } from "./utils/logger.js";

function createTranslator(config: Config): Translator {
  switch (config.backend) {
    case "google-free":
      return createGoogleFreeTranslator();
    case "haiku":
      if (!config.auth) {
        throw new Error("Auth is required for the 'haiku' backend");
      }
      return createHaikuTranslator(config.auth);
    default:
      throw new Error(`Unsupported backend: ${config.backend}`);
  }
}

const HELP_TEXT = `
mercury — Translation proxy for Claude Code

Usage:
  mercury              Start HTTP translation proxy (default)
  mercury http         Start HTTP translation proxy
  mercury help         Show this help message

Environment variables:
  MERCURY_BACKEND            Translation backend: google-free (default), haiku
  MERCURY_SOURCE_LANG        Source language: auto (default)
  MERCURY_TARGET_LANG        Target language: en (default)
  MERCURY_PORT               Proxy port: 3100 (default)
  MERCURY_UPSTREAM_URL       Upstream API URL: https://api.anthropic.com (default)
  MERCURY_MIN_DETECT_LENGTH  Minimum text length for detection: 20 (default)
  MERCURY_LOG_LEVEL          Log level: debug, info, warn, error (default: info)

  # Required only for 'haiku' backend:
  ANTHROPIC_API_KEY          API key for Haiku translation
  ANTHROPIC_AUTH_TOKEN       OAuth token for Haiku translation (alternative)

Example:
  # Start proxy with npx (uses Google Translate, no API key needed)
  npx @lambda-script/mercury

  # Use with Claude Code
  ANTHROPIC_BASE_URL=http://localhost:3100 claude
`.trim();

async function main() {
  const command = process.argv[2];

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (!command || command === "http") {
    const config = loadConfig();
    const detector = createFrancDetector(config.minDetectLength);
    const translator = createTranslator(config);
    const proxy = createHttpProxy(config, detector, translator);

    process.on("SIGINT", async () => {
      logger.info("Shutting down...");
      await proxy.stop();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      logger.info("Shutting down...");
      await proxy.stop();
      process.exit(0);
    });

    await proxy.start();
  } else {
    console.error(`Unknown command: ${command}`);
    console.log(HELP_TEXT);
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
