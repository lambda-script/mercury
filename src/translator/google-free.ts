import translate from "google-translate-api-x";
import type { Translator } from "./index.js";
import { logger } from "../utils/logger.js";

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 500;
const TLD_ROTATION = ["com", "co.jp", "co.uk"] as const;

// Google Translate free has a ~5000 char limit per request
const MAX_CHUNK_CHARS = 4500;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause ? ` (cause: ${err.cause})` : "";
    return `${err.message}${cause}`;
  }
  return String(err);
}

/**
 * Split text into chunks at paragraph/sentence boundaries,
 * each under MAX_CHUNK_CHARS.
 */
function splitIntoChunks(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) {
    return [text];
  }

  // Track a sliding `start` index instead of repeatedly slicing the tail.
  // The previous implementation called `remaining.slice(splitIdx).trimStart()`
  // each iteration, which is O(N) per step and O(N²) overall for large inputs.
  const chunks: string[] = [];
  const len = text.length;
  let start = 0;

  while (start < len) {
    if (len - start <= MAX_CHUNK_CHARS) {
      chunks.push(text.slice(start));
      break;
    }

    const windowEnd = start + MAX_CHUNK_CHARS;

    // Try to split at paragraph boundary (\n\n)
    let splitIdx = text.lastIndexOf("\n\n", windowEnd);
    if (splitIdx <= start) {
      // Try single newline
      splitIdx = text.lastIndexOf("\n", windowEnd);
    }
    if (splitIdx <= start) {
      // Try sentence boundary (. followed by space)
      splitIdx = text.lastIndexOf(". ", windowEnd);
      if (splitIdx > start) splitIdx += 1; // include the period
    }
    if (splitIdx <= start) {
      // Hard split as last resort
      splitIdx = windowEnd;
    }

    chunks.push(text.slice(start, splitIdx));

    // Skip leading whitespace for the next chunk (replaces trimStart on a fresh slice).
    start = splitIdx;
    while (start < len) {
      const ch = text.charCodeAt(start);
      if (ch !== 0x20 && ch !== 0x09 && ch !== 0x0a && ch !== 0x0d && ch !== 0x0c) break;
      start++;
    }
  }

  return chunks;
}

async function translateChunk(
  text: string,
  fromLang: string,
  to: string,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const tld = TLD_ROTATION[attempt % TLD_ROTATION.length];
    try {
      const result = await translate(text, {
        from: fromLang,
        to,
        tld,
        forceBatch: false,
      });

      return result.text;
    } catch (err) {
      const errorDetail = getErrorMessage(err);
      logger.warn(
        `Translation attempt ${attempt + 1}/${MAX_RETRIES} failed (tld=${tld}, ${text.length} chars): ${errorDetail}`,
      );

      if (attempt < MAX_RETRIES - 1) {
        const delay = INITIAL_DELAY_MS * Math.pow(2, attempt);
        logger.debug(`Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  // All retries exhausted — return original text as graceful degradation
  logger.warn(
    `All ${MAX_RETRIES} attempts failed for chunk (${text.length} chars). Returning original.`,
  );
  return text;
}

/**
 * Create a Google Translate (free) translator using google-translate-api-x.
 *
 * Features:
 * - No API key required
 * - Automatic chunking at paragraph/sentence boundaries (max 4500 chars per chunk)
 * - Retry with TLD rotation (com, co.jp, co.uk) and exponential backoff (3 attempts)
 * - Graceful degradation: Returns original text if all attempts fail
 *
 * @returns A translator instance
 */
export function createGoogleFreeTranslator(): Translator {
  return {
    async translate(text: string, from: string, to: string): Promise<string> {
      const fromLang = from === "auto" ? "auto" : from;
      const chunks = splitIntoChunks(text);

      logger.debug(
        `Translating ${text.length} chars from ${fromLang} to ${to} (${chunks.length} chunk${chunks.length > 1 ? "s" : ""})`,
      );

      const translated: string[] = [];
      for (const chunk of chunks) {
        translated.push(await translateChunk(chunk, fromLang, to));
      }

      const result = translated.join("\n");
      logger.debug(`Translation complete: ${result.length} chars`);
      return result;
    },
  };
}
