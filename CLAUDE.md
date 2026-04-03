# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

Mercury is an HTTP translation proxy for Claude Code. It sits between Claude Code and the Anthropic API, transparently translating non-English user messages to English before forwarding, reducing token consumption for non-English speakers (36-72% reduction depending on language).

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

The proxy intercepts `POST /v1/messages` requests, translates text content blocks, and forwards to the upstream Anthropic API. All other requests pass through untouched.

**Request flow:** `Claude Code → HTTP Proxy (src/proxy/http.ts) → Detect Language (src/detector/) → Translate if non-English (src/translator/) → Forward to api.anthropic.com`

### Key design decisions

- **Detector interface** (`src/detector/index.ts`): Abstracts language detection. Only implementation is franc-based (`franc.ts`). Short text (< `minDetectLength`) skips detection and is assumed to be the target language.
- **Translator interface** (`src/translator/index.ts`): Abstracts translation backends. Two implementations: `google-free.ts` (no API key, default) and `haiku.ts` (uses Claude Haiku via Anthropic SDK).
- **Transform layer** (`src/transform/messages.ts`): Walks the Anthropic Messages API structure (text blocks, tool_result content, nested arrays). Never translates `tool_use.input` (would corrupt JSON). When non-English input is detected, injects `IMPORTANT: Always respond in {language}.` into the system prompt so Claude responds in the user's original language.
- **Config** (`src/config.ts`): All configuration via environment variables (`MERCURY_*`). Supports both API key and OAuth token auth for the haiku backend.
- **OAuth beta header injection** (`src/proxy/http.ts`): When `Authorization: Bearer` is present, automatically adds `anthropic-beta: oauth-2025-04-20` header.

### Immutability

All interfaces use `readonly` properties. Transform functions return new objects via spread, never mutating inputs.

## Release Workflow

1. Bump `version` in `package.json` in a PR and merge
2. `version.yml` workflow detects the change and creates a `v*` tag
3. `release.yml` runs `npm publish --provenance` and creates a GitHub Release
