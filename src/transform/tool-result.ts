import type { Detector } from "../detector/index.js";
import type { Translator } from "../translator/index.js";
import { LANG_NAMES } from "../utils/lang.js";
import { logger } from "../utils/logger.js";
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
const URL_PATTERN = /^https?:\/\//;
const FILE_PATH_PATTERN = /^[/.~]/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/;
const WHITESPACE_PATTERN = /\s/;

// Find the index of the first non-whitespace character.
// Avoids allocating a trimmed string copy just to check a prefix.
function firstNonWsIndex(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch !== 0x20 && ch !== 0x09 && ch !== 0x0a && ch !== 0x0d && ch !== 0x0c) {
      return i;
    }
  }
  return text.length;
}

// Heuristic: does the text look like a markdown code block?
function isCodeBlock(text: string): boolean {
  return text.startsWith("```", firstNonWsIndex(text));
}

// Try to parse as JSON. Returns parsed value or null.
function tryParseJson(text: string): unknown | null {
  if (text.length > MAX_JSON_CHECK_BYTES) return null;
  const idx = firstNonWsIndex(text);
  const ch = text.charCodeAt(idx);
  // Check for '{' (0x7B) or '[' (0x5B)
  if (ch !== 0x7b && ch !== 0x5b) return null;
  try {
    // JSON.parse natively skips leading whitespace
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

// Heuristic: does the string look like a URL, path, or identifier?
function isStructuralString(text: string): boolean {
  // URLs
  if (URL_PATTERN.test(text)) return true;
  // File paths
  if (FILE_PATH_PATTERN.test(text) && !text.includes(" ")) return true;
  // ISO dates
  if (ISO_DATE_PATTERN.test(text)) return true;
  // Identifiers (no spaces, short)
  if (text.length < MIN_JSON_STRING_LENGTH && !WHITESPACE_PATTERN.test(text)) return true;
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
 * Recursively walk a JSON value and translate string values that
 * appear to contain natural language (non-English) text.
 * Returns a new value (never mutates input).
 */
async function translateJsonStrings(
  value: unknown,
  detector: Detector,
  translator: Translator,
  targetLang: string,
  stats: StatsAccumulator,
  depth = 0,
): Promise<unknown> {
  // Prevent stack overflow on deeply nested JSON
  if (depth > MAX_JSON_DEPTH) {
    logger.debug(`Max depth ${MAX_JSON_DEPTH} exceeded, stopping translation`);
    return value;
  }
  if (typeof value === "string") {
    // Skip short, structural, or already-target-lang strings
    if (value.length < MIN_JSON_STRING_LENGTH) return value;
    if (isStructuralString(value)) return value;
    if (isCodeBlock(value)) return value;
    if (detector.isTargetLang(value, targetLang)) return value;

    return translateAndTrack(value, detector, translator, targetLang, stats);
  }

  if (Array.isArray(value)) {
    // Process array items in parallel for better performance
    return Promise.all(
      value.map((item) =>
        translateJsonStrings(item, detector, translator, targetLang, stats, depth + 1),
      ),
    );
  }

  if (typeof value === "object" && value !== null) {
    // Walk object entries in parallel for the same reason as arrays.
    // Stats counters are commutative (+=) so out-of-order updates are safe;
    // detectedLang is set once via the first detection that wins the race.
    const entries = Object.entries(value);
    const translatedValues = await Promise.all(
      entries.map(([, val]) =>
        translateJsonStrings(val, detector, translator, targetLang, stats, depth + 1),
      ),
    );
    const result: Record<string, unknown> = {};
    for (let i = 0; i < entries.length; i++) {
      result[entries[i][0]] = translatedValues[i];
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
  // Skip markdown code blocks
  if (isCodeBlock(text)) {
    logger.debug(`Skipping code block (${text.length} chars)`);
    stats.blocksSkipped += 1;
    return text;
  }

  // JSON content: translate string values inside the structure
  const parsed = tryParseJson(text);
  if (parsed !== null) {
    logger.debug(`Translating strings inside JSON block (${text.length} chars)`);
    const translated = await translateJsonStrings(parsed, detector, translator, targetLang, stats);
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

  const translatedContent: McpContent[] = [];
  for (const block of toolResult.content) {
    if (block.type === "text") {
      const translated = await translateText(
        block.text,
        detector,
        translator,
        targetLang,
        stats,
      );
      translatedContent.push({ ...block, text: translated });
    } else {
      // image, resource, etc — pass through
      translatedContent.push(block);
    }
  }

  return {
    content: { ...toolResult, content: translatedContent },
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
