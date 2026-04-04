# @lambda-script/mercury

Translation proxy for MCP servers — transparently translates non-English tool results to English to reduce token consumption.

## Why?

Non-English languages consume significantly more tokens than English due to tokenizer inefficiency. By translating MCP tool results to English before they reach Claude Code, mercury reduces input tokens by 28–64% depending on the language.

## How it works

```
Claude Code ──→ mercury (stdio proxy) ──→ MCP Server
                 ├─ Intercept JSON-RPC tool results
                 ├─ Language Detection (franc)
                 ├─ Translation (Google Translate / Claude Haiku)
                 └─ Skip code blocks, error results; translate strings inside JSON
```

1. Wraps an MCP server command as a stdio proxy
2. Intercepts JSON-RPC `tools/call` responses from the child MCP server
3. Detects non-English text in tool result content blocks
4. Translates text blocks to English using the configured backend
5. For JSON content, walks the structure and translates natural-language string values
6. Passes through code blocks, images, and error results untouched
7. Returns the translated result to Claude Code

## Requirements

- Node.js >= 20.0.0

## Quick Start

Prepend `npx @lambda-script/mercury --` to your existing MCP server command in `.mcp.json`.

### Google Translate (default, no API key needed)

```json
{
  "mcpServers": {
    "your-server": {
      "command": "npx",
      "args": ["@lambda-script/mercury", "--", "npx", "your-mcp-server"],
    }
  }
}
```

### Claude Haiku (higher quality, requires API key)

Claude Code does **not** pass `ANTHROPIC_*` env vars to MCP servers automatically — you must set them explicitly:

```json
{
  "mcpServers": {
    "your-server": {
      "command": "npx",
      "args": ["@lambda-script/mercury", "--", "npx", "your-mcp-server"],
      "env": {
        "MERCURY_BACKEND": "haiku",
        "ANTHROPIC_API_KEY": "sk-ant-...",
      }
    }
  }
}
```

## Translation Backends

| Backend | `MERCURY_BACKEND` | API Key Required | Notes |
|---------|-------------------|------------------|-------|
| **Google Translate (free)** | `google-free` (default) | No | Uses `google-translate-api-x`. No signup needed. Auto-chunking for long text, retry with TLD rotation. |
| Claude Haiku | `haiku` | Yes (`ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`) | Higher quality, but adds LLM cost. |

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MERCURY_BACKEND` | `google-free` | Translation backend: `google-free`, `haiku` |
| `MERCURY_TARGET_LANG` | `en` | Target language for translation |
| `MERCURY_SOURCE_LANG` | `auto` | Source language (`auto` for detection) |
| `MERCURY_MIN_DETECT_LENGTH` | `20` | Minimum text length for language detection |
| `MERCURY_LOG_LEVEL` | `info` | Log level: debug, info, warn, error |
| `MERCURY_LOG_FILE` | *(none)* | Log to file instead of stderr (useful for MCP servers where stderr is swallowed) |
| `MERCURY_HAIKU_MODEL` | `claude-haiku-4-5-20251001` | Model ID for the haiku backend |

### Haiku backend only

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | API key for Haiku translation |
| `ANTHROPIC_AUTH_TOKEN` | OAuth token (alternative to API key). The `anthropic-beta: oauth-2025-04-20` header is added automatically. |

## Benchmark

Measured with the [Anthropic token counting API](https://docs.anthropic.com/en/docs/build-with-claude/token-counting) (`claude-sonnet-4-20250514` tokenizer) using 5 realistic MCP tool result scenarios (wiki articles, API responses with JSON, documentation with code blocks, long articles, and mixed multi-block results).

### Token Reduction by Language

```
Hindi          ████████████████████████████████░░░░░░░░░░░░░░░░░░░  64%  4009 → 1430 tok
Arabic         ████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░  57%  3326 → 1424 tok
Korean         █████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░  51%  2927 → 1430 tok
Russian        █████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  43%  2513 → 1433 tok
Japanese       ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  41%  2538 → 1488 tok
German         ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  41%  2403 → 1430 tok
French         ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  33%  2120 → 1427 tok
Spanish        ███████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  30%  2037 → 1424 tok
Chinese (Sim.) ██████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  28%  1992 → 1427 tok
English        ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0%  (baseline)
```

Token counts are the sum across all 5 scenarios. Scenarios with JSON/code blocks (skipped by Mercury) show lower reduction rates than text-only scenarios.

### Translation Fidelity (Mercury output tokens vs original EN)

Closer to 1.00x = better. Values far from 1.00x indicate information loss or added verbosity.

| Language | Google Free |
|----------|-------------|
| Hindi | 1.00x (+0%) |
| Arabic | 1.00x (+0%) |
| Korean | 1.00x (+0%) |
| Russian | 1.01x (+1%) |
| Japanese | 1.04x (+4%) |
| German | 1.00x (+0%) |
| French | 1.00x (+0%) |
| Spanish | 1.00x (+0%) |
| Chinese (Sim.) | 1.00x (+0%) |

The google-free backend produces translations within ~4% of the original English token count at $0 translation cost.

Run benchmarks yourself: `npm run benchmark` (requires `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`).

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Watch mode
npm run dev

# Run MCP tool result benchmark
npm run benchmark
```

<!-- AUTO-GENERATED:scripts -->
| Command | Description |
|---------|-------------|
| `npm run build` | Production build with tsup |
| `npm run dev` | Watch mode build |
| `npm test` | Run test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |
| `npm run lint` | Lint source code |
| `npm run typecheck` | Type check without emitting |
| `npm run benchmark` | Run MCP tool result token reduction benchmark |
<!-- /AUTO-GENERATED:scripts -->

## Architecture

```
src/
├── index.ts              # CLI entry point & backend selection
├── config.ts             # Environment-based configuration
├── detector/
│   ├── index.ts          # Detector interface
│   └── franc.ts          # franc + Unicode script-based language detection
├── translator/
│   ├── index.ts          # Translator interface
│   ├── google-free.ts    # Google Translate (free, auto-chunking, retry with TLD rotation)
│   └── haiku.ts          # Claude Haiku backend
├── transform/
│   └── tool-result.ts    # MCP tool result translation (translates JSON strings, skips code/errors)
├── proxy/
│   ├── stdio.ts          # MCP stdio proxy (JSON-RPC message interception)
│   └── tracker.ts        # JSON-RPC request ID → method name tracker
└── utils/
    ├── logger.ts         # Logging utility
    ├── lang.ts           # Language name mappings
    └── tokens.ts         # Unicode script-based token estimation
```

## License

MIT
