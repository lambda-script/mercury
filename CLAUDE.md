# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

Mercury is a translation proxy for MCP servers used with Claude Code. It wraps MCP server commands via stdio, transparently translating non-English tool results to English to reduce token consumption (28-64% reduction depending on language).

## Commands

```bash
npm run build        # Build with tsup (ESM, Node 20 target, adds shebang)
npm run lint         # ESLint with typescript-eslint flat config
npm run typecheck    # tsc --noEmit
npm test             # vitest run (all tests)
npx vitest run tests/unit/config.test.ts  # Run a single test file
npm run test:coverage  # Coverage report (80% threshold enforced)
```

## Architecture

### MCP stdio proxy

Mercury wraps an MCP server as a stdio proxy, intercepting JSON-RPC 2.0 messages. Tool call results containing non-English text are translated to English before being returned to Claude Code.

**Request flow:** `Claude Code → Mercury (stdio) → MCP Server (child process)`
**Response flow:** `MCP Server → Mercury (translate tool results) → Claude Code`

```json
// .mcp.json configuration example
{
  "mcpServers": {
    "your-server": {
      "command": "npx",
      "args": ["@lambda-script/mercury", "--", "npx", "your-mcp-server"]
    }
  }
}
```

### Key design decisions

- **Stdio proxy** (`src/proxy/stdio.ts`): Spawns child MCP server process, pipes stdin/stdout/stderr. Intercepts JSON-RPC responses, translates `tools/call` results, strips `outputSchema` from `tools/list` responses.
- **Request tracker** (`src/proxy/tracker.ts`): Maps JSON-RPC request IDs to method names (like tooner's `wait.go`). Used to identify which responses correspond to `tools/call` or `tools/list` requests.
- **Tool result transform** (`src/transform/tool-result.ts`): Translates text content blocks in MCP tool results. For JSON content, recursively walks the structure and translates natural-language string values (skips URLs, paths, dates, short identifiers). Skips code blocks and error results. Returns transform statistics.
- **Detector interface** (`src/detector/index.ts`): Abstracts language detection. Only implementation is franc-based (`franc.ts`). For short text (< `minDetectLength`), uses Unicode script-based detection (Hiragana/Katakana → Japanese, Hangul → Korean, CJK → Chinese, etc.) before falling back to "undetermined". Longer text uses franc's trigram analysis.
- **Translator interface** (`src/translator/index.ts`): Abstracts translation backends. Two implementations: `google-free.ts` (no API key, default) and `haiku.ts` (uses Claude Haiku via Anthropic SDK).
- **google-free resilience** (`src/translator/google-free.ts`): Text is chunked at paragraph/sentence boundaries (max 4500 chars) to stay under Google Translate's ~5000 char limit. Each chunk retries up to 3 times with TLD rotation (`com`, `co.jp`, `co.uk`) and exponential backoff. On total failure, returns original text (graceful degradation).
- **Config** (`src/config.ts`): All configuration via environment variables (`MERCURY_*`). No dotenv — env vars must be set by the caller (e.g., `.mcp.json` `env` field). Supports both API key and OAuth token auth for the haiku backend. Note: Claude Code does NOT automatically pass `ANTHROPIC_AUTH_TOKEN` to MCP server processes — haiku backend requires explicit env configuration.
- **Logger** (`src/utils/logger.ts`): Writes to stderr by default (preserves stdout for JSON-RPC). Set `MERCURY_LOG_FILE` for file-based logging when stderr is swallowed (e.g., Claude Code MCP servers).

### Immutability

All interfaces use `readonly` properties. Transform functions return new objects via spread, never mutating inputs.

## Release Workflow

1. Merge PRs with Conventional Commit titles to `main`
2. `release-please.yml` automatically creates/updates a Release PR (CHANGELOG.md + version bump)
3. Merge the Release PR → release-please creates a GitHub Release and runs `npm publish --provenance` in the same workflow
