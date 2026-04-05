import type { Detector } from "../detector/index.js";
import type { Translator } from "../translator/index.js";
import { LANG_NAMES } from "../utils/lang.js";
import { logger } from "../utils/logger.js";
import { estimateTokens } from "../utils/tokens.js";

export interface TransformStats {
  readonly blocksTranslated: number;
  readonly blocksSkipped: number;
  readonly charsOriginal: number;
  readonly charsTransformed: number;
  readonly tokensOriginal: number;
  readonly tokensTransformed: number;
  readonly detectedLang: string | null;
}

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

// Heuristic: does the text look like a markdown code block?
function isCodeBlock(text: string): boolean {
  return text.trimStart().startsWith("```");
}

// Try to parse as JSON. Returns parsed value or null.
function tryParseJson(text: string): unknown | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  if (trimmed.length > MAX_JSON_CHECK_BYTES) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

// Heuristic: does the string look like a URL, path, or identifier?
function isStructuralString(text: string): boolean {
  // URLs
  if (/^https?:\/\//.test(text)) return true;
  // File paths
  if (/^[/.~]/.test(text) && !text.includes(" ")) return true;
  // ISO dates
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return true;
  // Identifiers (no spaces, short)
  if (text.length < MIN_JSON_STRING_LENGTH && !/\s/.test(text)) return true;
  return false;
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
): Promise<unknown> {
  if (typeof value === "string") {
    // Skip short, structural, or already-target-lang strings
    if (value.length < MIN_JSON_STRING_LENGTH) return value;
    if (isStructuralString(value)) return value;
    if (isCodeBlock(value)) return value;
    if (detector.isTargetLang(value, targetLang)) return value;

    // Detect language
    if (!stats.detectedLang) {
      const detected = detector.detect(value);
      if (detected.confidence > 0) {
        stats.detectedLang = detected.lang;
      }
    }

    stats.blocksTranslated += 1;
    stats.charsOriginal += value.length;
    stats.tokensOriginal += estimateTokens(value);

    const translated = await translator.translate(value, "auto", targetLang);
    stats.charsTransformed += translated.length;
    stats.tokensTransformed += estimateTokens(translated);

    return translated;
  }

  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value) {
      result.push(await translateJsonStrings(item, detector, translator, targetLang, stats));
    }
    return result;
  }

  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = await translateJsonStrings(val, detector, translator, targetLang, stats);
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

  // Detect language (first block wins)
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
