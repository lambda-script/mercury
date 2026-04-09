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
 * A chunk plus the separator that originally followed it in the source text.
 * Tracking the separator out-of-band lets us reassemble the translated chunks
 * losslessly, instead of clobbering paragraph breaks (\n\n) and sentence
 * spaces with a synthetic "\n".
 */
interface Chunk {
  readonly text: string;
  /** Original separator that followed this chunk; "" for the final chunk. */
  readonly separator: string;
}

/**
 * If hard-splitting at `idx` would land between a UTF-16 surrogate pair
 * (e.g. an emoji or a CJK character above the BMP), back off by one so the
 * pair stays intact. Returns a safe split index ≤ `idx`.
 */
function safeHardSplitIndex(text: string, idx: number): number {
  if (idx <= 0 || idx >= text.length) return idx;
  const high = text.charCodeAt(idx - 1);
  const low = text.charCodeAt(idx);
  if (high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) {
    return idx - 1;
  }
  return idx;
}

/**
 * Split text into chunks at paragraph/sentence boundaries, each under
 * MAX_CHUNK_CHARS. Returns chunks paired with the separator that originally
 * followed them in the source, so the translated output can be reassembled
 * without losing the original whitespace structure.
 */
function splitIntoChunks(text: string): Chunk[] {
  if (text.length <= MAX_CHUNK_CHARS) {
    return [{ text, separator: "" }];
  }

  const chunks: Chunk[] = [];
  let remaining = text;

  while (remaining.length > MAX_CHUNK_CHARS) {
    let splitIdx = -1;
    let separator = "";

    // Paragraph boundary (\n\n)
    const paraIdx = remaining.lastIndexOf("\n\n", MAX_CHUNK_CHARS);
    if (paraIdx > 0) {
      splitIdx = paraIdx;
      separator = "\n\n";
    }

    // Single newline
    if (splitIdx < 0) {
      const nlIdx = remaining.lastIndexOf("\n", MAX_CHUNK_CHARS);
      if (nlIdx > 0) {
        splitIdx = nlIdx;
        separator = "\n";
      }
    }

    // Sentence boundary (period followed by space)
    if (splitIdx < 0) {
      const sentIdx = remaining.lastIndexOf(". ", MAX_CHUNK_CHARS);
      if (sentIdx > 0) {
        splitIdx = sentIdx + 1; // keep the period in this chunk
        separator = " ";
      }
    }

    // Hard split as last resort, avoiding surrogate pairs
    if (splitIdx < 0) {
      splitIdx = safeHardSplitIndex(remaining, MAX_CHUNK_CHARS);
      separator = "";
    }

    chunks.push({ text: remaining.slice(0, splitIdx), separator });
    remaining = remaining.slice(splitIdx + separator.length);
  }

  if (remaining.length > 0) {
    chunks.push({ text: remaining, separator: "" });
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

      let result = "";
      for (const chunk of chunks) {
        const translated = await translateChunk(chunk.text, fromLang, to);
        result += translated + chunk.separator;
      }

      logger.debug(`Translation complete: ${result.length} chars`);
      return result;
    },
  };
}
