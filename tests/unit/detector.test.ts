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

  describe("script-based detection for various scripts", () => {
    const strictDetector = createFrancDetector(200);

    it("should detect Korean via Hangul script", () => {
      const result = strictDetector.detect("한국어 텍스트");
      expect(result.lang).toBe("kor");
      expect(result.confidence).toBe(1);
    });

    it("should detect Chinese via CJK unified ideographs (no kana)", () => {
      const result = strictDetector.detect("中文测试文本");
      expect(result.lang).toBe("cmn");
      expect(result.confidence).toBe(1);
    });

    it("should detect Arabic via Arabic script", () => {
      const result = strictDetector.detect("مرحبا بالعالم");
      expect(result.lang).toBe("ara");
      expect(result.confidence).toBe(1);
    });

    it("should detect Hindi via Devanagari script", () => {
      const result = strictDetector.detect("नमस्ते दुनिया");
      expect(result.lang).toBe("hin");
      expect(result.confidence).toBe(1);
    });

    it("should detect Bengali via Bengali script", () => {
      const result = strictDetector.detect("বাংলা ভাষা");
      expect(result.lang).toBe("ben");
      expect(result.confidence).toBe(1);
    });

    it("should detect Thai via Thai script", () => {
      const result = strictDetector.detect("สวัสดีครับ");
      expect(result.lang).toBe("tha");
      expect(result.confidence).toBe(1);
    });

    it("should detect Russian via Cyrillic script", () => {
      const result = strictDetector.detect("Привет мир");
      expect(result.lang).toBe("rus");
      expect(result.confidence).toBe(1);
    });
  });

  describe("kana override for Japanese vs Chinese", () => {
    it("should override cmn to jpn when kana is present in long text", () => {
      // Kanji-heavy text with some kana — franc may detect as cmn, but kana overrides
      const text = "漢字が多いテキストですが、ひらがなも含まれています。日本語の文章として認識されるべきです。";
      const result = detector.detect(text);
      expect(result.lang).toBe("jpn");
    });
  });

  describe("isTargetLang edge cases", () => {
    it("should return true for short Japanese text when target is jpn", () => {
      // Short text with kana — script detection returns jpn, which matches target
      expect(detector.isTargetLang("テスト", "ja")).toBe(true);
    });

    it("should return false for short Korean text when target is eng", () => {
      // Short text with Hangul — script detection returns kor, doesn't match eng
      expect(detector.isTargetLang("한국어", "en")).toBe(false);
    });

    it("should return true when franc returns undetermined for long text", () => {
      // Numbers/symbols only — franc returns undetermined, treated as target lang
      const result = detector.isTargetLang("1234567890 + 1234567890 = 2469135780", "en");
      expect(result).toBe(true);
    });

    it("should convert ISO 639-1 target to ISO 639-3 for comparison", () => {
      // "en" should be converted to "eng" internally
      expect(
        detector.isTargetLang(
          "This is a test text in English for language detection.",
          "en",
        ),
      ).toBe(true);
    });
  });
});
