import { franc } from "franc";
import type { Detector, DetectResult } from "./index.js";

const UNDETERMINED = "und";

export function createFrancDetector(minLength: number): Detector {
  return {
    detect(text: string): DetectResult {
      if (text.length < minLength) {
        return { lang: UNDETERMINED, confidence: 0 };
      }

      const lang = franc(text);
      // franc returns "und" when it can't determine the language
      const confidence = lang === UNDETERMINED ? 0 : 1;
      return { lang, confidence };
    },

    isTargetLang(text: string, targetLang: string): boolean {
      if (text.length < minLength) {
        return true; // Assume target lang for short text (skip translation)
      }
      const result = this.detect(text);
      if (result.lang === UNDETERMINED) {
        return true; // Can't determine, skip translation
      }
      return result.lang === targetLang;
    },
  };
}
