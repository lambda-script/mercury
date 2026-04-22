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

  describe("cache", () => {
    it("should return cached result for identical text", () => {
      const cachingDetector = createFrancDetector(20);
      const text = "これは日本語のテストテキストです。翻訳が必要です。";

      const first = cachingDetector.detect(text);
      const second = cachingDetector.detect(text);

      expect(second).toBe(first);
    });

    it("should invalidate cache when text changes", () => {
      const cachingDetector = createFrancDetector(20);

      const r1 = cachingDetector.detect("This is a test text in English for language detection.");
      const r2 = cachingDetector.detect("これは日本語のテストテキストです。翻訳が必要です。");

      expect(r1.lang).toBe("eng");
      expect(r2.lang).toBe("jpn");
    });
  });

  describe("kana override", () => {
    it("should override cmn to jpn when text contains kana", () => {
      // Kanji-heavy text with some kana — franc may return "cmn" but
      // kana presence is definitive proof of Japanese.
      const text = "漢字が多い文章ですが、ひらがなも含まれています。翻訳テストです。";
      const result = detector.detect(text);
      expect(result.lang).toBe("jpn");
    });
  });

  describe("isTargetLang with non-English targets", () => {
    it("should return true for short non-Latin text matching target lang", () => {
      // Short Korean text (< minLength) — script detection returns "kor".
      // When target is "kor", should match and return true.
      expect(detector.isTargetLang("안녕", "kor")).toBe(true);
    });

    it("should return false for short non-Latin text not matching target lang", () => {
      // Short Japanese text when target is Korean
      expect(detector.isTargetLang("こんにちは", "kor")).toBe(false);
    });

    it("should return true for long text matching a non-English target", () => {
      const longJapanese = "これは日本語のテストテキストです。翻訳が必要です。";
      expect(detector.isTargetLang(longJapanese, "jpn")).toBe(true);
    });

    it("should return false for long text not matching target", () => {
      const longJapanese = "これは日本語のテストテキストです。翻訳が必要です。";
      expect(detector.isTargetLang(longJapanese, "kor")).toBe(false);
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

  describe("script-based detection for non-Latin scripts", () => {
    const shortDetector = createFrancDetector(1000);

    it("should detect Arabic script", () => {
      const result = shortDetector.detect("مرحبا بالعالم");
      expect(result.lang).toBe("ara");
      expect(result.confidence).toBe(1);
    });

    it("should detect Devanagari as Hindi", () => {
      const result = shortDetector.detect("नमस्ते दुनिया");
      expect(result.lang).toBe("hin");
      expect(result.confidence).toBe(1);
    });

    it("should detect Bengali script", () => {
      const result = shortDetector.detect("হ্যালো বিশ্ব");
      expect(result.lang).toBe("ben");
      expect(result.confidence).toBe(1);
    });

    it("should detect Thai script", () => {
      const result = shortDetector.detect("สวัสดีชาวโลก");
      expect(result.lang).toBe("tha");
      expect(result.confidence).toBe(1);
    });

    it("should detect Cyrillic as Russian", () => {
      const result = shortDetector.detect("Привет мир");
      expect(result.lang).toBe("rus");
      expect(result.confidence).toBe(1);
    });

    it("should detect Hangul as Korean", () => {
      const result = shortDetector.detect("안녕하세요");
      expect(result.lang).toBe("kor");
      expect(result.confidence).toBe(1);
    });

    it("should detect CJK without kana as Chinese", () => {
      const result = shortDetector.detect("你好世界");
      expect(result.lang).toBe("cmn");
      expect(result.confidence).toBe(1);
    });
  });

  describe("isTargetLang with ISO 639-1 codes", () => {
    it("should convert 2-letter code to 3-letter for comparison", () => {
      expect(
        detector.isTargetLang("This is a test text in English for language detection.", "en"),
      ).toBe(true);
    });

    it("should detect non-target when using 2-letter code", () => {
      expect(
        detector.isTargetLang("これは日本語のテストテキストです。翻訳が必要です。", "en"),
      ).toBe(false);
    });
  });
});
