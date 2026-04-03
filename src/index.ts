import { loadConfig } from "./config.js";
import { createFrancDetector } from "./detector/franc.js";
import { createHaikuTranslator } from "./translator/haiku.js";
import { createHttpProxy } from "./proxy/http.js";
import { logger } from "./utils/logger.js";

const HELP_TEXT = `
mercury-mcp - Translation proxy for Claude Code

Usage:
  mercury-mcp http     Start HTTP translation proxy
  mercury-mcp help     Show this help message

Environment variables:
  ANTHROPIC_API_KEY          Required. API key for Haiku translation
  MERCURY_BACKEND            Translation backend: haiku (default)
  MERCURY_SOURCE_LANG        Source language: auto (default)
  MERCURY_TARGET_LANG        Target language: en (default)
  MERCURY_PORT               Proxy port: 3100 (default)
  MERCURY_UPSTREAM_URL       Upstream API URL: https://api.anthropic.com (default)
  MERCURY_MIN_DETECT_LENGTH  Minimum text length for detection: 20 (default)
  MERCURY_LOG_LEVEL          Log level: debug, info, warn, error (default: info)

Example:
  # Start proxy
  mercury-mcp http

  # Use with Claude Code
  ANTHROPIC_BASE_URL=http://localhost:3100 claude
`.trim();

async function main() {
  const command = process.argv[2];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (command === "http") {
    const config = loadConfig();
    const detector = createFrancDetector(config.minDetectLength);
    const translator = createHaikuTranslator(config.anthropicApiKey);
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
