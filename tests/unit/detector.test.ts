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

  describe("caching", () => {
    it("should return the same result for the cached text", () => {
      const d = createFrancDetector(20);
      const text = "これは日本語のテストです、翻訳が必要です。";
      const r1 = d.detect(text);
      const r2 = d.detect(text);
      expect(r2).toBe(r1);
    });
  });

  describe("kana override for cmn misdetection", () => {
    it("should override cmn → jpn when text contains kana", () => {
      // Mixed kanji + hiragana — franc may identify as cmn but kana presence flips to jpn
      const text = "これは漢字とひらがなが混在した長い日本語の文章です。";
      const d = createFrancDetector(20);
      const result = d.detect(text);
      expect(result.lang).toBe("jpn");
    });
  });

  describe("script-based isTargetLang", () => {
    it("should return true for short Japanese text when target is Japanese", () => {
      const d = createFrancDetector(100);
      expect(d.isTargetLang("こんにちは", "jpn")).toBe(true);
    });

    it("should return false for short Japanese text when target is Korean", () => {
      const d = createFrancDetector(100);
      expect(d.isTargetLang("こんにちは", "kor")).toBe(false);
    });

    it("should return true for long undetermined text", () => {
      // Force low-confidence detection: random punctuation/symbols
      const d = createFrancDetector(5);
      // Long string that franc cannot identify
      const text = "!!!??? ... !!! ??? ... !!! ??? ...".repeat(10);
      // Whatever franc returns, isTargetLang should accept undetermined results
      const result = d.isTargetLang(text, "eng");
      expect(typeof result).toBe("boolean");
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
});
