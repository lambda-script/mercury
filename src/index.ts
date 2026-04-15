import { loadConfig } from "./config.js";
import type { Config } from "./config.js";
import { createFrancDetector } from "./detector/franc.js";
import { createGoogleFreeTranslator } from "./translator/google-free.js";
import { createHaikuTranslator } from "./translator/haiku.js";
import type { Translator } from "./translator/index.js";
import { createStdioProxy } from "./proxy/stdio.js";
import { logger } from "./utils/logger.js";

function createTranslator(config: Config): Translator {
  switch (config.backend) {
    case "google-free":
      return createGoogleFreeTranslator();
    case "haiku":
      if (!config.auth) {
        throw new Error(
          "Auth is required for the 'haiku' backend. " +
          "Set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN in the 'env' field of your .mcp.json configuration."
        );
      }
      return createHaikuTranslator(config.auth, config.haikuModel);
    default:
      throw new Error(
        `Unsupported backend: '${config.backend}'. ` +
        `Set MERCURY_BACKEND to 'google-free' (default, no API key) or 'haiku' (requires ANTHROPIC_API_KEY).`
      );
  }
}

const HELP_TEXT = `
mercury — MCP stdio translation proxy

Usage:
  mercury [options] -- <command> [args...]

Wraps an MCP server command, translating tool results from non-English
to English to reduce token consumption.

Example .mcp.json:
  {
    "mcpServers": {
      "your-server": {
        "command": "npx",
        "args": ["@lambda-script/mercury", "--", "npx", "your-mcp-server"]
      }
    }
  }

Options:
  -h, --help             Show this help message

Environment variables:
  MERCURY_BACKEND            Translation backend: google-free (default), haiku
  MERCURY_SOURCE_LANG        Source language: auto (default)
  MERCURY_TARGET_LANG        Target language: en (default)
  MERCURY_MIN_DETECT_LENGTH  Minimum text length for detection: 20 (default)
  MERCURY_LOG_LEVEL          Log level: debug, info, warn, error (default: info)
  MERCURY_LOG_FILE           Log to file instead of stderr
  MERCURY_HAIKU_MODEL        Model ID for haiku backend (default: claude-haiku-4-5-20251001)

  # Required only for 'haiku' backend:
  ANTHROPIC_API_KEY          API key for Haiku translation
  ANTHROPIC_AUTH_TOKEN       OAuth token for Haiku translation (alternative)
`.trim();

function parseArgs(argv: readonly string[]): {
  mode: "stdio" | "help";
  childCommand?: string;
  childArgs?: string[];
} {
  const args = argv.slice(2);

  // Check for help flag anywhere
  if (args.includes("-h") || args.includes("--help") || args.includes("help")) {
    return { mode: "help" };
  }

  // Check for -- separator (stdio proxy mode)
  const separatorIdx = args.indexOf("--");
  if (separatorIdx !== -1 && separatorIdx + 1 < args.length) {
    const childCommand = args[separatorIdx + 1];
    const childArgs = args.slice(separatorIdx + 2);
    return { mode: "stdio", childCommand, childArgs };
  }

  // No arguments — show help
  if (args.length === 0) {
    return { mode: "help" };
  }

  // Assume anything else is a child command without --
  return { mode: "stdio", childCommand: args[0], childArgs: args.slice(1) };
}

async function main() {
  const parsed = parseArgs(process.argv);

  if (parsed.mode === "help") {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const config = loadConfig();
  const detector = createFrancDetector(config.minDetectLength);
  const translator = createTranslator(config);

  if (!parsed.childCommand) {
    console.error("Error: No child command specified.");
    console.error("Usage: mercury -- <command> [args...]");
    console.error("Example: mercury -- npx your-mcp-server");
    console.error("Run 'mercury --help' for more details.");
    process.exit(1);
  }

  // MCP stdio proxy mode
  logger.info(`mercury — MCP stdio translation proxy`);
  logger.info(`Backend: ${config.backend} | Target: ${config.targetLang}`);

  const proxy = createStdioProxy(
    parsed.childCommand,
    parsed.childArgs ?? [],
    detector,
    translator,
    config.targetLang,
  );

  await proxy.start();
}

main().catch((err) => {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
