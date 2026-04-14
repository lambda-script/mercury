import { describe, it, expect } from "vitest";
import { createFrancDetector } from "../../src/detector/franc.js";

describe("FrancDetector", () => {
  const detector = createFrancDetector(20);

  describe("detect", () => {
    it("should detect Japanese text", () => {
      const result = detector.detect("これは日本語のテストテキストです。翻訳が必要です。");
      expect(result.lang).toBe("jpn");
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("should detect English text", () => {
      const result = detector.detect("This is a test text in English for language detection.");
      expect(result.lang).toBe("eng");
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("should return undetermined for short text", () => {
      const result = detector.detect("short");
      expect(result.lang).toBe("und");
      expect(result.confidence).toBe(0);
    });

    it("should return undetermined for empty text", () => {
      const result = detector.detect("");
      expect(result.lang).toBe("und");
      expect(result.confidence).toBe(0);
    });
  });

  describe("isTargetLang", () => {
    it("should return true for English text when target is eng", () => {
      expect(
        detector.isTargetLang("This is a test text in English for language detection.", "eng"),
      ).toBe(true);
    });

    it("should return false for Japanese text when target is eng", () => {
      expect(
        detector.isTargetLang("これは日本語のテストテキストです。翻訳が必要です。", "eng"),
      ).toBe(false);
    });

    it("should return true for short text (skip detection)", () => {
      expect(detector.isTargetLang("hi", "eng")).toBe(true);
    });

    it("should return true for empty text", () => {
      expect(detector.isTargetLang("", "eng")).toBe(true);
    });
  });

  describe("custom minLength", () => {
    it("should use script detection for short non-Latin text", () => {
      const strictDetector = createFrancDetector(100);
      // Short Japanese text: franc skipped, but script detection finds kana
      const result = strictDetector.detect("これは短いテキストです。");
      expect(result.lang).toBe("jpn");
      expect(result.confidence).toBe(1);
    });

    it("should return undetermined for short Latin text", () => {
      const strictDetector = createFrancDetector(100);
      // Short Latin text: franc skipped, no non-Latin script found
      const result = strictDetector.detect("Hello world");
      expect(result.lang).toBe("und");
      expect(result.confidence).toBe(0);
    });
  });

  describe("detect cache", () => {
    it("should return cached result for the same text", () => {
      const det = createFrancDetector(20);
      const text = "これは日本語のテストテキストです。翻訳が必要です。";
      const first = det.detect(text);
      const second = det.detect(text);
      // Same object reference (cache hit)
      expect(second).toBe(first);
      expect(second.lang).toBe("jpn");
    });

    it("should invalidate cache when text changes", () => {
      const det = createFrancDetector(20);
      const r1 = det.detect("これは日本語のテストテキストです。翻訳が必要です。");
      const r2 = det.detect("This is a test text in English for language detection.");
      expect(r1.lang).toBe("jpn");
      expect(r2.lang).toBe("eng");
    });
  });

  describe("cmn to jpn kana override", () => {
    it("should override cmn detection to jpn when kana is present", () => {
      // Kanji-heavy Japanese text with some kana — franc may detect as cmn,
      // but the kana override should correct to jpn.
      const kanjiHeavy = "漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字の文章です";
      const result = detector.detect(kanjiHeavy);
      expect(result.lang).toBe("jpn");
      expect(result.confidence).toBe(1);
    });
  });

  describe("isTargetLang edge cases", () => {
    it("should return true for short non-Latin text matching target lang", () => {
      // Short Japanese text with target "jpn" — script detection finds kana,
      // scriptLang === target3, so isTargetLang returns true.
      expect(detector.isTargetLang("こんにちは", "jpn")).toBe(true);
    });

    it("should return false for short non-Latin text NOT matching target lang", () => {
      // Short Korean text with target "jpn" — script detection finds Hangul,
      // which != jpn.
      expect(detector.isTargetLang("안녕하세요", "jpn")).toBe(false);
    });

    it("should return true for short non-Latin text with ISO-1 target code", () => {
      // Target as "ja" (ISO 639-1) should be converted to "jpn" via toIso3.
      expect(detector.isTargetLang("こんにちは", "ja")).toBe(true);
    });

    it("should detect various scripts in short text", () => {
      const det = createFrancDetector(100);
      // Arabic script → "ara"
      expect(det.detect("مرحبا").lang).toBe("ara");
      // Devanagari → "hin"
      expect(det.detect("नमस्ते").lang).toBe("hin");
      // Bengali → "ben"
      expect(det.detect("বাংলা").lang).toBe("ben");
      // Thai → "tha"
      expect(det.detect("สวัสดี").lang).toBe("tha");
      // Cyrillic → "rus"
      expect(det.detect("Привет").lang).toBe("rus");
      // Hangul → "kor"
      expect(det.detect("안녕하세요").lang).toBe("kor");
    });
  });
});
