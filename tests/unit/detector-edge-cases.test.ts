import { describe, it, expect, vi } from "vitest";
import { createFrancDetector } from "../../src/detector/franc.js";

describe("FrancDetector edge cases", () => {
  describe("1-entry cache", () => {
    it("should return cached result on consecutive identical detect() calls", () => {
      const detector = createFrancDetector(20);
      const text = "これは日本語のテストテキストです。翻訳が必要です。";

      const first = detector.detect(text);
      const second = detector.detect(text);

      expect(first).toBe(second); // same object reference = cache hit
      expect(first.lang).toBe("jpn");
    });

    it("should invalidate cache when text changes", () => {
      const detector = createFrancDetector(20);

      const r1 = detector.detect("これは日本語のテストテキストです。翻訳が必要です。");
      const r2 = detector.detect("This is a test text in English for language detection.");

      expect(r1.lang).toBe("jpn");
      expect(r2.lang).toBe("eng");
      expect(r1).not.toBe(r2);
    });
  });

  describe("franc cmn → jpn kana override", () => {
    it("should override cmn to jpn when kana is present in kanji-heavy text", () => {
      // Kanji-heavy text with a small amount of hiragana — franc may detect as
      // Chinese (cmn) because of the overwhelming kanji, but kana proves it's Japanese.
      const kanjiHeavy = "漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字の文章です";
      const detector = createFrancDetector(10);
      const result = detector.detect(kanjiHeavy);

      // Whether franc returns "cmn" or "jpn", our kana override should ensure
      // the final answer is "jpn" because of the の and です kana.
      expect(result.lang).toBe("jpn");
    });
  });

  describe("isTargetLang with short non-Latin script matching target", () => {
    it("should return true for short Japanese text when target is jpn", () => {
      const detector = createFrancDetector(100);
      // Short kana text — below minLength, script detection finds Hiragana → jpn
      // Target is also jpn → should match (line 88)
      expect(detector.isTargetLang("こんにちは", "jpn")).toBe(true);
    });

    it("should return false for short Japanese text when target is eng", () => {
      const detector = createFrancDetector(100);
      // Script detects jpn, target is eng → mismatch
      expect(detector.isTargetLang("こんにちは", "eng")).toBe(false);
    });

    it("should return true for short Korean text when target is kor", () => {
      const detector = createFrancDetector(100);
      expect(detector.isTargetLang("안녕", "kor")).toBe(true);
    });

    it("should return false for short Korean text when target is eng", () => {
      const detector = createFrancDetector(100);
      expect(detector.isTargetLang("안녕", "eng")).toBe(false);
    });

    it("should return true for short CJK text when target is cmn", () => {
      const detector = createFrancDetector(100);
      // Pure kanji (no kana) → script detects cmn
      expect(detector.isTargetLang("中文", "cmn")).toBe(true);
    });
  });

  describe("isTargetLang with undetermined language", () => {
    it("should return true when franc returns undetermined for long ambiguous text", () => {
      const detector = createFrancDetector(20);
      // Numeric/symbol gibberish that franc can't classify
      const ambiguous = "1234567890 !@#$%^&*() 1234567890 !@#$%^&*()";
      expect(detector.isTargetLang(ambiguous, "eng")).toBe(true);
    });
  });

  describe("isTargetLang with ISO 639-1 target codes", () => {
    it("should convert 2-letter codes to 3-letter before comparison", () => {
      const detector = createFrancDetector(20);
      // "en" should be converted to "eng" via toIso3
      const englishText = "This is a long English text for proper detection by franc trigrams.";
      expect(detector.isTargetLang(englishText, "en")).toBe(true);
    });

    it("should return false when detected language does not match target", () => {
      const detector = createFrancDetector(20);
      const japaneseText = "これは日本語のテストテキストです。翻訳が必要です。";
      expect(detector.isTargetLang(japaneseText, "en")).toBe(false);
    });
  });

  describe("script-based detection for various scripts", () => {
    const detector = createFrancDetector(100);

    it("should detect Arabic script", () => {
      const result = detector.detect("مرحبا");
      expect(result.lang).toBe("ara");
      expect(result.confidence).toBe(1);
    });

    it("should detect Devanagari as Hindi", () => {
      const result = detector.detect("नमस्ते");
      expect(result.lang).toBe("hin");
      expect(result.confidence).toBe(1);
    });

    it("should detect Bengali script", () => {
      const result = detector.detect("স্বাগতম");
      expect(result.lang).toBe("ben");
      expect(result.confidence).toBe(1);
    });

    it("should detect Thai script", () => {
      const result = detector.detect("สวัสดี");
      expect(result.lang).toBe("tha");
      expect(result.confidence).toBe(1);
    });

    it("should detect Cyrillic as Russian", () => {
      const result = detector.detect("Привет");
      expect(result.lang).toBe("rus");
      expect(result.confidence).toBe(1);
    });
  });
});
