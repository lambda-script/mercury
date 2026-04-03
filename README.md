# @lambda-script/mercury

Translation proxy for Claude Code — transparently translates non-English text to English to reduce token consumption.

## Why?

Non-English languages consume significantly more tokens than English due to tokenizer inefficiency. By translating user messages to English before they reach Claude, mercury reduces input tokens by 36–72% depending on the language.

## How it works

```
Claude Code ──→ mercury (translate) ──→ Anthropic API
                 ├─ Language Detection (franc)
                 └─ Translation (Google Translate / Claude Haiku)
```

1. Intercepts requests to the Anthropic Messages API
2. Detects non-English text in user messages
3. Translates to English using the configured backend
4. Forwards the translated request to the upstream API
5. Streams the response back untouched (Claude responds in English)

**Important**: `tool_use.input` is never translated to prevent JSON parameter corruption.

## Quick Start

```bash
# Run with npx (no install needed)
npx @lambda-script/mercury

# Or install globally
npm install -g @lambda-script/mercury
mercury

# In another terminal, use Claude Code with the proxy
ANTHROPIC_BASE_URL=http://localhost:3100 claude
```

No API key is required by default — mercury uses Google Translate (unofficial) as the translation backend.

## Translation Backends

| Backend | `MERCURY_BACKEND` | API Key Required | Notes |
|---------|-------------------|------------------|-------|
| **Google Translate (free)** | `google-free` (default) | No | Uses `google-translate-api-x`. No signup needed. |
| Claude Haiku | `haiku` | Yes (`ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`) | Higher quality, but adds LLM cost. |

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MERCURY_BACKEND` | `google-free` | Translation backend: `google-free`, `haiku` |
| `MERCURY_PORT` | `3100` | Proxy listen port |
| `MERCURY_TARGET_LANG` | `en` | Target language for translation |
| `MERCURY_SOURCE_LANG` | `auto` | Source language (`auto` for detection) |
| `MERCURY_UPSTREAM_URL` | `https://api.anthropic.com` | Upstream API URL |
| `MERCURY_MIN_DETECT_LENGTH` | `20` | Minimum text length for language detection |
| `MERCURY_LOG_LEVEL` | `info` | Log level: debug, info, warn, error |

### Haiku backend only

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | API key for Haiku translation |
| `ANTHROPIC_AUTH_TOKEN` | OAuth token (alternative to API key). The `anthropic-beta: oauth-2025-04-20` header is added automatically. |

## Benchmark

Measured with the [Anthropic token counting API](https://docs.anthropic.com/en/docs/build-with-claude/token-counting) (`claude-sonnet-4-20250514` tokenizer). Each language tested with 3 samples (short ~30 tok, medium ~80 tok, long ~170 tok).

### Token Reduction by Language

```
Hindi          ████████████████████████████████████░░░░░░░░░░░░░░  72%  683 → 190 tok
Arabic         ███████████████████████████████░░░░░░░░░░░░░░░░░░░  63%  511 → 190 tok
Korean         ███████████████████████████████░░░░░░░░░░░░░░░░░░░  62%  501 → 190 tok
Russian        ██████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░  53%  406 → 190 tok
German         █████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░  52%  394 → 190 tok
Japanese       ████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░  49%  374 → 190 tok
French         █████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  42%  328 → 190 tok
Spanish        ███████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  39%  309 → 190 tok
Chinese (Sim.) ██████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  36%  297 → 190 tok
English        ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0%  (baseline)
```

### Translation Fidelity (translated EN tokens vs original EN)

Closer to 1.00x = better. Values far from 1.00x indicate information loss or added verbosity.

| Language | Google Free | Haiku |
|----------|-------------|-------|
| Hindi | 0.98x (-2%) | 0.99x (-1%) |
| Arabic | 0.98x (-2%) | 1.02x (+2%) |
| Korean | 1.06x (+6%) | 1.04x (+4%) |
| Russian | 1.01x (+1%) | 1.04x (+4%) |
| German | 1.04x (+4%) | 1.04x (+4%) |
| Japanese | 1.04x (+4%) | 1.04x (+4%) |
| French | 0.98x (-2%) | 1.02x (+2%) |
| Spanish | 1.00x (+0%) | 1.01x (+1%) |
| Chinese (Sim.) | 0.95x (-5%) | 0.99x (-1%) |

Both backends produce translations within ~5% of the original English token count. With the default `google-free` backend, translation cost is $0.

Run benchmarks yourself: `npm run benchmark:multi` (requires `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`).

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

# Run token cost benchmark
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
| `npm run benchmark` | Run token cost benchmark |
| `npm run benchmark:multi` | Run multilingual token reduction benchmark |
<!-- /AUTO-GENERATED:scripts -->

## Architecture

```
src/
├── index.ts              # CLI entry point & backend selection
├── config.ts             # Environment-based configuration
├── detector/
│   ├── index.ts          # Detector interface
│   └── franc.ts          # franc-based language detection
├── translator/
│   ├── index.ts          # Translator interface
│   ├── google-free.ts    # Google Translate (free, no API key)
│   └── haiku.ts          # Claude Haiku backend
├── transform/
│   └── messages.ts       # Messages API request transformation
├── proxy/
│   └── http.ts           # HTTP proxy server (+ OAuth beta header injection)
└── utils/
    └── logger.ts         # Logging utility
```

## License

MIT
