# mercury-mcp

Translation proxy for Claude Code — transparently translates non-English text to English to reduce token consumption.

## Why?

Non-English languages consume significantly more tokens than English. For example, Japanese uses approximately **3x more tokens** than English for the same semantic content. By translating user messages to English before they reach Claude, you can achieve substantial cost savings. The translation cost (using Claude Haiku at ~1/12 the price) is far less than the savings from reduced token usage.

## How it works

```
Claude Code ──→ mercury-mcp (translate) ──→ Anthropic API
                 ├─ Language Detection (franc)
                 └─ Translation (Claude Haiku)
```

1. Intercepts requests to the Anthropic Messages API
2. Detects non-English text in user messages
3. Translates to English using Claude Haiku
4. Forwards the translated request to the upstream API
5. Streams the response back untouched (Claude responds in English)

**Important**: `tool_use.input` is never translated to prevent JSON parameter corruption.

## Quick Start

```bash
# Install
npm install -g mercury-mcp

# Start the proxy (requires ANTHROPIC_API_KEY)
mercury-mcp http

# In another terminal, use Claude Code with the proxy
ANTHROPIC_BASE_URL=http://localhost:3100 claude
```

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | (required) | API key for Haiku translation |
| `MERCURY_PORT` | `3100` | Proxy listen port |
| `MERCURY_TARGET_LANG` | `en` | Target language for translation |
| `MERCURY_SOURCE_LANG` | `auto` | Source language (`auto` for detection) |
| `MERCURY_UPSTREAM_URL` | `https://api.anthropic.com` | Upstream API URL |
| `MERCURY_MIN_DETECT_LENGTH` | `20` | Minimum text length for language detection |
| `MERCURY_LOG_LEVEL` | `info` | Log level: debug, info, warn, error |

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
```

## Architecture

```
src/
├── index.ts              # CLI entry point
├── config.ts             # Environment-based configuration
├── detector/
│   ├── index.ts          # Detector interface
│   └── franc.ts          # franc-based language detection
├── translator/
│   ├── index.ts          # Translator interface
│   └── haiku.ts          # Claude Haiku backend
├── transform/
│   └── messages.ts       # Messages API request transformation
├── proxy/
│   └── http.ts           # HTTP proxy server
└── utils/
    └── logger.ts         # Logging utility
```

## License

MIT
