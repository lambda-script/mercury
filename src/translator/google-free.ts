import translate from "google-translate-api-x";
import type { Translator } from "./index.js";
import { logger } from "../utils/logger.js";

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 500;
const TLD_ROTATION = ["com", "co.jp", "co.uk"] as const;

// Google Translate free has a ~5000 char limit per request
const MAX_CHUNK_CHARS = 4500;

// Per-attempt timeout. Without this, a hung HTTPS connection would block the
// stdio proxy's serial translation queue forever, freezing all tool responses.
const ATTEMPT_TIMEOUT_MS = 15_000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Race a promise against a timeout. Rejects with a timeout error if the
 * promise doesn't settle within `ms`. The timer is unref'd so it does not
 * keep the event loop alive on its own.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Translation attempt timed out after ${ms}ms`)),
          ms,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause ? ` (cause: ${err.cause})` : "";
    return `${err.message}${cause}`;
  }
  return String(err);
}

/**
 * Adjust a split index so it never falls between the two halves of a UTF-16
 * surrogate pair. Splitting mid-pair would corrupt non-BMP characters
 * (emoji, rare CJK) by leaving an unpaired surrogate in each chunk.
 */
function safeSplitIndex(text: string, idx: number): number {
  if (idx <= 0 || idx >= text.length) return idx;
  const code = text.charCodeAt(idx);
  // Low surrogate at idx means idx-1 is its high surrogate; back up so the
  // pair stays together in the next chunk.
  if (code >= 0xdc00 && code <= 0xdfff) return idx - 1;
  return idx;
}

/**
 * Split text into chunks at paragraph/sentence boundaries,
 * each under MAX_CHUNK_CHARS.
 */
function splitIntoChunks(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHUNK_CHARS) {
      chunks.push(remaining);
      break;
    }

    // Try to split at paragraph boundary (\n\n)
    let splitIdx = remaining.lastIndexOf("\n\n", MAX_CHUNK_CHARS);
    if (splitIdx <= 0) {
      // Try single newline
      splitIdx = remaining.lastIndexOf("\n", MAX_CHUNK_CHARS);
    }
    if (splitIdx <= 0) {
      // Try sentence boundary (. followed by space)
      splitIdx = remaining.lastIndexOf(". ", MAX_CHUNK_CHARS);
      if (splitIdx > 0) splitIdx += 1; // include the period
    }
    if (splitIdx <= 0) {
      // Hard split as last resort — guard against splitting a surrogate pair.
      splitIdx = safeSplitIndex(remaining, MAX_CHUNK_CHARS);
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
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
      const result = await withTimeout(
        translate(text, {
          from: fromLang,
          to,
          tld,
          forceBatch: false,
        }),
        ATTEMPT_TIMEOUT_MS,
      );

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
 * - Per-attempt timeout (15s) so a hung connection cannot freeze the proxy queue
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
