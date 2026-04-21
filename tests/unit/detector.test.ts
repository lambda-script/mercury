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

  describe("script-based detection for short text", () => {
    const shortDetector = createFrancDetector(200);

    it("should detect short Korean text by Hangul script", () => {
      const result = shortDetector.detect("안녕하세요 세계");
      expect(result.lang).toBe("kor");
      expect(result.confidence).toBe(1);
    });

    it("should detect short Arabic text by Arabic script", () => {
      const result = shortDetector.detect("مرحبا بالعالم");
      expect(result.lang).toBe("ara");
      expect(result.confidence).toBe(1);
    });

    it("should detect short Hindi text by Devanagari script", () => {
      const result = shortDetector.detect("नमस्ते दुनिया");
      expect(result.lang).toBe("hin");
      expect(result.confidence).toBe(1);
    });

    it("should detect short Bengali text by Bengali script", () => {
      const result = shortDetector.detect("হ্যালো বিশ্ব");
      expect(result.lang).toBe("ben");
      expect(result.confidence).toBe(1);
    });

    it("should detect short Thai text by Thai script", () => {
      const result = shortDetector.detect("สวัสดีชาวโลก");
      expect(result.lang).toBe("tha");
      expect(result.confidence).toBe(1);
    });

    it("should detect short Russian text by Cyrillic script", () => {
      const result = shortDetector.detect("Привет мир");
      expect(result.lang).toBe("rus");
      expect(result.confidence).toBe(1);
    });

    it("should detect short CJK text (no kana) as Chinese", () => {
      const result = shortDetector.detect("你好世界");
      expect(result.lang).toBe("cmn");
      expect(result.confidence).toBe(1);
    });
  });

  describe("franc kana override for long text", () => {
    it("should keep cmn for pure Chinese text without any kana", () => {
      // Long Chinese text with no kana characters — franc detects "cmn"
      // and the kana override should NOT apply.
      const pureChinese = "这是一段很长的中文文本，用于测试语言检测功能。这段文字完全由汉字组成，没有任何日文假名字符。";
      const result = detector.detect(pureChinese);
      expect(result.lang).toBe("cmn");
      expect(result.confidence).toBe(1);
    });
  });

  describe("isTargetLang with ISO 639-1 codes", () => {
    it("should convert two-letter target code to ISO 639-3 for comparison", () => {
      // "en" → "eng" via toIso3
      const longEnglish = "This is a long English text that should be detected as English by franc analysis.";
      expect(detector.isTargetLang(longEnglish, "en")).toBe(true);
    });

    it("should return false for non-matching two-letter target code", () => {
      const longJapanese = "これは日本語のテストテキストです。翻訳が必要です。";
      expect(detector.isTargetLang(longJapanese, "en")).toBe(false);
    });
  });
});
