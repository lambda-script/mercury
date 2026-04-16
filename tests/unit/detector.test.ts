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
    it("should return cached result when called with the same text twice", () => {
      const d = createFrancDetector(20);
      const text = "これは日本語のテストテキストです。翻訳が必要です。";

      const first = d.detect(text);
      const second = d.detect(text);

      // Same reference proves the cache was hit (no re-computation).
      expect(second).toBe(first);
      expect(second.lang).toBe("jpn");
    });

    it("should invalidate cache when called with different text", () => {
      const d = createFrancDetector(20);

      const jpn = d.detect("これは日本語のテストテキストです。翻訳が必要です。");
      const eng = d.detect("This is a test text in English for language detection.");

      expect(jpn.lang).toBe("jpn");
      expect(eng.lang).toBe("eng");
    });
  });

  describe("kana override", () => {
    it("should override franc's cmn result to jpn when text contains kana", () => {
      // Kanji-heavy text with some kana. franc often returns "cmn" for kanji-heavy
      // Japanese, but kana presence is definitive proof of Japanese.
      // Use a long text that franc can analyze (>= minLength).
      const d = createFrancDetector(20);
      const kanjiHeavy = "漢字漢字漢字漢字漢字漢字漢字漢字漢字漢字の文章です。";
      const result = d.detect(kanjiHeavy);
      // Whether franc returns jpn or cmn→jpn override, final answer must be jpn
      // because Hiragana ("の", "です") are present.
      expect(result.lang).toBe("jpn");
    });
  });

  describe("script-based detection for various scripts", () => {
    const d = createFrancDetector(100); // high minLength forces script-based path

    it("should detect Korean (Hangul)", () => {
      expect(d.detect("한국어").lang).toBe("kor");
    });

    it("should detect Chinese (CJK without kana)", () => {
      expect(d.detect("中文测试").lang).toBe("cmn");
    });

    it("should detect Arabic", () => {
      expect(d.detect("مرحبا").lang).toBe("ara");
    });

    it("should detect Hindi (Devanagari)", () => {
      expect(d.detect("नमस्ते").lang).toBe("hin");
    });

    it("should detect Bengali", () => {
      expect(d.detect("বাংলা").lang).toBe("ben");
    });

    it("should detect Thai", () => {
      expect(d.detect("สวัสดี").lang).toBe("tha");
    });

    it("should detect Russian (Cyrillic)", () => {
      expect(d.detect("Привет").lang).toBe("rus");
    });
  });

  describe("isTargetLang edge cases", () => {
    it("should return false for short non-Latin text when script differs from target", () => {
      const d = createFrancDetector(100); // high minLength: short text uses script
      // Korean script detected, target is Japanese → not the target language
      expect(d.isTargetLang("한국어", "jpn")).toBe(false);
    });

    it("should return true for short non-Latin text when script matches target", () => {
      const d = createFrancDetector(100);
      // Japanese script detected, target is "ja" (maps to "jpn") → match
      expect(d.isTargetLang("これは", "ja")).toBe(true);
    });

    it("should return true when franc returns undetermined for long text", () => {
      const d = createFrancDetector(10);
      // Gibberish long enough for franc but unrecognizable → und → treated as target
      const gibberish = "aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm";
      // If franc can't determine the language, isTargetLang should return true.
      // (franc may or may not return "und" for this; we test the logic path.)
      const detected = d.detect(gibberish);
      if (detected.lang === "und") {
        expect(d.isTargetLang(gibberish, "eng")).toBe(true);
      }
    });
  });
});
