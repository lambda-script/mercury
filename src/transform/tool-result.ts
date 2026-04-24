import type { Detector } from "../detector/index.js";
import type { Translator } from "../translator/index.js";
import { LANG_NAMES } from "../utils/lang.js";
import { logger } from "../utils/logger.js";
import { firstNonWsIndex } from "../utils/strings.js";
import { estimateTokens } from "../utils/tokens.js";

/** Statistics from transforming a single MCP tool result. */
export interface TransformStats {
  /** Number of content blocks that were translated. */
  readonly blocksTranslated: number;
  /** Number of content blocks skipped (code blocks, already target language). */
  readonly blocksSkipped: number;
  /** Total characters in original text before translation. */
  readonly charsOriginal: number;
  /** Total characters in translated text. */
  readonly charsTransformed: number;
  /** Estimated token count of original text (used for savings calculation). */
  readonly tokensOriginal: number;
  /** Estimated token count of translated text. */
  readonly tokensTransformed: number;
  /** ISO 639-3 code of the first detected non-target language, or null if none detected. */
  readonly detectedLang: string | null;
}

/** Result of transforming an MCP tool result: the (possibly translated) content and transform statistics. */
export interface ToolResultTransformResult {
  readonly content: unknown;
  readonly stats: TransformStats;
}

interface StatsAccumulator {
  blocksTranslated: number;
  blocksSkipped: number;
  charsOriginal: number;
  charsTransformed: number;
  tokensOriginal: number;
  tokensTransformed: number;
  detectedLang: string | null;
}

// Maximum bytes to attempt JSON.parse on for the code/JSON heuristic.
const MAX_JSON_CHECK_BYTES = 64 * 1024;

// Minimum string length in JSON worth translating.
// Short strings (keys, IDs, URLs) are not worth the overhead.
const MIN_JSON_STRING_LENGTH = 20;

// Maximum recursion depth for JSON walker (prevent stack overflow).
const MAX_JSON_DEPTH = 50;

// Pre-compiled patterns for isStructuralString (called per JSON string value).
// Char-code prefilters in isStructuralString gate these so most strings never
// run any regex at all.
const URL_PATTERN = /^https?:\/\//;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/;

// Heuristic: does the text look like a markdown code block?
function isCodeBlock(text: string, wsIdx?: number): boolean {
  return text.startsWith("```", wsIdx ?? firstNonWsIndex(text));
}

/**
 * Try to parse `text` as a JSON object or array.
 *
 * Returns `{ value }` on success and `null` on any failure (too large, not
 * starting with `{`/`[`, or `JSON.parse` threw). The wrapper distinguishes
 * "parse failed" from "parsed value happens to be falsy".
 */
function tryParseJsonObject(text: string, wsIdx?: number): { value: unknown } | null {
  if (text.length > MAX_JSON_CHECK_BYTES) return null;
  const idx = wsIdx ?? firstNonWsIndex(text);
  const ch = text.charCodeAt(idx);
  // Only attempt parse on '{' (0x7B) or '[' (0x5B); skips primitives & garbage.
  if (ch !== 0x7b && ch !== 0x5b) return null;
  try {
    // JSON.parse natively skips leading whitespace.
    return { value: JSON.parse(text) as unknown };
  } catch {
    return null;
  }
}

// Heuristic: does the string look like a URL, path, or ISO date?
// Callers guarantee text.length >= MIN_JSON_STRING_LENGTH, so no
// short-identifier branch is needed here.
function isStructuralString(text: string): boolean {
  const ch = text.charCodeAt(0);

  // URL: starts with 'h' (https?:// is the only allowed prefix).
  if (ch === 0x68 /* h */) {
    return URL_PATTERN.test(text);
  }
  // File path: starts with '/', '.', or '~' and contains no space.
  if (ch === 0x2f /* / */ || ch === 0x2e /* . */ || ch === 0x7e /* ~ */) {
    return text.indexOf(" ") === -1;
  }
  // ISO date: starts with a digit (YYYY-MM-DD…).
  if (ch >= 0x30 && ch <= 0x39) {
    return ISO_DATE_PATTERN.test(text);
  }
  return false;
}

/**
 * Shared helper: detect language, update stats, translate, update stats.
 * Used by both translateJsonStrings and translatePlainText.
 */
async function translateAndTrack(
  text: string,
  detector: Detector,
  translator: Translator,
  targetLang: string,
  stats: StatsAccumulator,
): Promise<string> {
  if (!stats.detectedLang) {
    const detected = detector.detect(text);
    if (detected.confidence > 0) {
      stats.detectedLang = detected.lang;
    }
  }

  stats.blocksTranslated += 1;
  stats.charsOriginal += text.length;
  stats.tokensOriginal += estimateTokens(text);

  const translated = await translator.translate(text, "auto", targetLang);
  stats.charsTransformed += translated.length;
  stats.tokensTransformed += estimateTokens(translated);

  return translated;
}

/**
 * Decide whether a string value found inside a JSON document is worth
 * translating. Skips short / structural / code-block / already-target-lang
 * strings.
 */
function shouldTranslateJsonString(
  text: string,
  detector: Detector,
  targetLang: string,
): boolean {
  if (text.length < MIN_JSON_STRING_LENGTH) return false;
  if (isStructuralString(text)) return false;
  if (isCodeBlock(text)) return false;
  if (detector.isTargetLang(text, targetLang)) return false;
  return true;
}

/**
 * Recursively walk a JSON value and translate string values that
 * appear to contain natural language (non-English) text.
 * Returns a new value (never mutates input).
 *
 * Sibling values inside arrays *and* objects are translated concurrently
 * via Promise.all so a single deeply-structured payload is not bottlenecked
 * on serial round-trips.
 */
async function translateJsonStrings(
  value: unknown,
  detector: Detector,
  translator: Translator,
  targetLang: string,
  stats: StatsAccumulator,
  depth = 0,
): Promise<unknown> {
  // Prevent stack overflow on deeply nested JSON.
  if (depth > MAX_JSON_DEPTH) {
    logger.debug(`Max depth ${MAX_JSON_DEPTH} exceeded, stopping translation`);
    return value;
  }

  if (typeof value === "string") {
    if (!shouldTranslateJsonString(value, detector, targetLang)) return value;
    return translateAndTrack(value, detector, translator, targetLang, stats);
  }

  if (Array.isArray(value)) {
    const translated = await Promise.all(
      value.map((item) =>
        translateJsonStrings(item, detector, translator, targetLang, stats, depth + 1),
      ),
    );
    for (let i = 0; i < translated.length; i++) {
      if (translated[i] !== value[i]) return translated;
    }
    return value;
  }

  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    const translatedValues = await Promise.all(
      keys.map((key) =>
        translateJsonStrings(obj[key], detector, translator, targetLang, stats, depth + 1),
      ),
    );
    let changed = false;
    for (let i = 0; i < keys.length; i++) {
      if (translatedValues[i] !== obj[keys[i]]) {
        changed = true;
        break;
      }
    }
    if (!changed) return value;
    const result: Record<string, unknown> = {};
    for (let i = 0; i < keys.length; i++) {
      result[keys[i]] = translatedValues[i];
    }
    return result;
  }

  // numbers, booleans, null — pass through
  return value;
}

async function translatePlainText(
  text: string,
  detector: Detector,
  translator: Translator,
  targetLang: string,
  stats: StatsAccumulator,
): Promise<string> {
  if (detector.isTargetLang(text, targetLang)) {
    logger.debug("Text already in target language, skipping translation");
    stats.blocksSkipped += 1;
    return text;
  }

  return translateAndTrack(text, detector, translator, targetLang, stats);
}

/**
 * Translate a text block from a tool result.
 * - Code blocks (```) → skip
 * - JSON content → walk string values and translate non-English ones
 * - Plain text → translate if non-English
 */
async function translateText(
  text: string,
  detector: Detector,
  translator: Translator,
  targetLang: string,
  stats: StatsAccumulator,
): Promise<string> {
  const wsIdx = firstNonWsIndex(text);

  // Skip markdown code blocks
  if (isCodeBlock(text, wsIdx)) {
    logger.debug(`Skipping code block (${text.length} chars)`);
    stats.blocksSkipped += 1;
    return text;
  }

  // JSON content: translate string values inside the structure
  const parsed = tryParseJsonObject(text, wsIdx);
  if (parsed !== null) {
    logger.debug(`Translating strings inside JSON block (${text.length} chars)`);
    const blocksBefore = stats.blocksTranslated;
    const translated = await translateJsonStrings(
      parsed.value,
      detector,
      translator,
      targetLang,
      stats,
    );
    // If the walker didn't translate any string (all values were short,
    // structural, or already in target language), the parsed tree is
    // structurally identical to the input — return the original text to
    // skip the JSON.stringify cost and preserve the original formatting.
    if (stats.blocksTranslated === blocksBefore) {
      return text;
    }
    return JSON.stringify(translated, null, 2);
  }

  // Plain text
  return translatePlainText(text, detector, translator, targetLang, stats);
}

/**
 * MCP tool result content structure:
 * { content: [{ type: "text", text: "..." }, ...] }
 * or
 * { content: [{ type: "text", text: "..." }] }
 */
interface McpTextContent {
  readonly type: "text";
  readonly text: string;
}

interface McpImageContent {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
}

interface McpResourceContent {
  readonly type: "resource";
  readonly resource: unknown;
}

type McpContent = McpTextContent | McpImageContent | McpResourceContent;

interface McpToolResult {
  readonly content?: readonly McpContent[];
  readonly isError?: boolean;
  readonly [key: string]: unknown;
}

/**
 * Transform an MCP tool result by translating non-target-language text to the target language.
 *
 * Translation logic:
 * - Text blocks: Translates non-target-language text, skips code blocks (```)
 * - JSON content: Recursively walks structure and translates natural-language string values
 *   (skips URLs, file paths, dates, short identifiers)
 * - Image/resource blocks: Pass through unchanged
 * - Error results: Pass through unchanged (preserves original error text)
 *
 * @param result - The MCP tool result object (with content array)
 * @param detector - Language detector for identifying text language
 * @param translator - Translation backend
 * @param targetLang - Target language code (e.g., "en")
 * @returns Transformed result with translated content and statistics (tokens saved, blocks translated)
 */
export async function transformToolResult(
  result: unknown,
  detector: Detector,
  translator: Translator,
  targetLang: string,
): Promise<ToolResultTransformResult> {
  const stats: StatsAccumulator = {
    blocksTranslated: 0,
    blocksSkipped: 0,
    charsOriginal: 0,
    charsTransformed: 0,
    tokensOriginal: 0,
    tokensTransformed: 0,
    detectedLang: null,
  };

  if (!result || typeof result !== "object") {
    return { content: result, stats };
  }

  const toolResult = result as McpToolResult;

  // Skip error results — preserve original error text
  if (toolResult.isError) {
    return { content: result, stats };
  }

  if (!Array.isArray(toolResult.content)) {
    return { content: result, stats };
  }

  const translatedContent = await Promise.all(
    toolResult.content.map(async (block): Promise<McpContent> => {
      if (block.type === "text") {
        const translated = await translateText(
          block.text,
          detector,
          translator,
          targetLang,
          stats,
        );
        if (translated === block.text) return block;
        return { ...block, text: translated };
      }
      return block;
    }),
  );

  let contentChanged = false;
  for (let i = 0; i < translatedContent.length; i++) {
    if (translatedContent[i] !== toolResult.content[i]) {
      contentChanged = true;
      break;
    }
  }

  return {
    content: contentChanged ? { ...toolResult, content: translatedContent } : result,
    stats,
  };
}

/**
 * Format transformation statistics as a human-readable log message.
 *
 * @param stats - Transform statistics from transformToolResult
 * @returns Formatted string showing detected language, blocks translated/skipped, and token reduction
 * @example "[Japanese] Translated 3 blocks (1 skipped) | ~2538 -> ~1488 tok (-41.0%)"
 */
export function formatTransformStats(stats: TransformStats): string {
  const lang = stats.detectedLang
    ? (LANG_NAMES[stats.detectedLang] ?? stats.detectedLang)
    : "unknown";

  if (stats.blocksTranslated === 0) {
    return `[${lang}] No translation needed (${stats.blocksSkipped} blocks skipped)`;
  }

  const pct = stats.tokensOriginal > 0
    ? ((1 - stats.tokensTransformed / stats.tokensOriginal) * 100).toFixed(1)
    : "0";

  return (
    `[${lang}] Translated ${stats.blocksTranslated} blocks (${stats.blocksSkipped} skipped) | ` +
    `~${stats.tokensOriginal} -> ~${stats.tokensTransformed} tok (-${pct}%)`
  );
}
