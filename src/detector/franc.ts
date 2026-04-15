import { franc } from "franc";
import type { Detector, DetectResult } from "./index.js";
import { toIso3 } from "../utils/lang.js";

const UNDETERMINED = "und";

// Script-based detection for short text where franc is unreliable.
// Returns ISO 639-3 code or null if only Latin/ASCII.
const SCRIPT_PATTERNS: readonly [RegExp, string][] = [
  [/[\u3040-\u309F\u30A0-\u30FF]/, "jpn"],  // Hiragana / Katakana → Japanese
  [/[\uAC00-\uD7AF]/, "kor"],                // Hangul → Korean
  [/[\u4E00-\u9FFF]/, "cmn"],                // CJK Unified → Chinese (fallback if no kana)
  [/[\u0600-\u06FF]/, "ara"],                // Arabic script
  [/[\u0900-\u097F]/, "hin"],                // Devanagari → Hindi
  [/[\u0980-\u09FF]/, "ben"],                // Bengali script
  [/[\u0E00-\u0E7F]/, "tha"],                // Thai script
  [/[\u0400-\u04FF]/, "rus"],                // Cyrillic → Russian (best guess)
];

// Hiragana or Katakana presence is a definitive marker for Japanese.
// Chinese text never contains kana, so this is a reliable override.
const KANA_PATTERN = /[\u3040-\u309F\u30A0-\u30FF]/;

function detectByScript(text: string): string | null {
  for (const [pattern, lang] of SCRIPT_PATTERNS) {
    if (pattern.test(text)) return lang;
  }
  return null;
}

/**
 * Create a language detector using franc (trigram analysis) with Unicode script fallback.
 *
 * Detection strategy:
 * - Short text (< minLength): Unicode script-based detection (Hiragana/Katakana → Japanese, etc.)
 * - Long text: franc trigram analysis, with kana override for Japanese vs Chinese disambiguation
 *
 * @param minLength - Minimum text length for franc detection (shorter text uses script-based detection)
 * @returns A detector instance
 */
export function createFrancDetector(minLength: number): Detector {
  // 1-entry cache: detect() is pure, so caching the last result
  // eliminates redundant franc() calls when isTargetLang() and detect()
  // are called on the same text (common in tool-result transform).
  let cachedText: string | null = null;
  let cachedResult: DetectResult | null = null;

  return {
    detect(text: string): DetectResult {
      if (text === cachedText && cachedResult !== null) {
        return cachedResult;
      }

      let result: DetectResult;

      // For short text, try script-based detection first
      if (text.length < minLength) {
        const scriptLang = detectByScript(text);
        if (scriptLang) {
          result = { lang: scriptLang, confidence: 1 };
        } else {
          result = { lang: UNDETERMINED, confidence: 0 };
        }
      } else {
        let lang = franc(text);
        // franc often misidentifies Japanese as Chinese (cmn) when kanji-heavy.
        // Kana presence is definitive proof of Japanese.
        if (lang === "cmn" && KANA_PATTERN.test(text)) {
          lang = "jpn";
        }
        const confidence = lang === UNDETERMINED ? 0 : 1;
        result = { lang, confidence };
      }

      cachedText = text;
      cachedResult = result;
      return result;
    },

    isTargetLang(text: string, targetLang: string): boolean {
      const target3 = toIso3(targetLang);

      // Route all text through detect() so the 1-entry cache is populated.
      // This avoids a redundant detectByScript() call when translateAndTrack()
      // subsequently calls detect() on the same text.
      const result = this.detect(text);
      if (result.confidence === 0) {
        // No language detected (undetermined / no non-Latin script) → assume target
        return true;
      }
      return result.lang === target3;
    },
  };
}
