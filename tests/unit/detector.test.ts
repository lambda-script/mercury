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

  describe("kana override for Chinese vs Japanese", () => {
    it("should override franc cmn→jpn when kana is present in long text", () => {
      // Kanji-heavy text with some kana — franc may detect as cmn
      // but kana presence should override to jpn
      const mixedText = "漢字が多いテキストですが、ひらがなも含まれています。この文章は日本語として検出されるべきです。";
      const result = detector.detect(mixedText);
      expect(result.lang).toBe("jpn");
      expect(result.confidence).toBe(1);
    });
  });

  describe("isTargetLang edge cases", () => {
    it("should return true for short non-Latin text matching target", () => {
      const strictDetector = createFrancDetector(100);
      // Short Korean text, target is Korean
      expect(strictDetector.isTargetLang("한국어", "kor")).toBe(true);
    });

    it("should return false for short non-Latin text not matching target", () => {
      const strictDetector = createFrancDetector(100);
      // Short Japanese text, target is English
      expect(strictDetector.isTargetLang("テスト", "eng")).toBe(false);
    });

    it("should return true when detect returns undetermined for long text", () => {
      // Undetermined text should be treated as target lang (skip translation)
      // Numbers/symbols that franc can't classify
      const ambiguous = "12345 67890 !@#$% ^&*() 12345 67890 !@#$%";
      expect(detector.isTargetLang(ambiguous, "eng")).toBe(true);
    });

    it("should handle ISO 639-1 target codes (e.g., 'en' → 'eng')", () => {
      expect(
        detector.isTargetLang("This is a test text in English for language detection.", "en"),
      ).toBe(true);
    });
  });

  describe("script detection for various scripts", () => {
    const strictDetector = createFrancDetector(1000); // Force script detection

    it("should detect Korean by Hangul script", () => {
      expect(strictDetector.detect("한국어 텍스트").lang).toBe("kor");
    });

    it("should detect Chinese by CJK characters (no kana)", () => {
      expect(strictDetector.detect("中文文本").lang).toBe("cmn");
    });

    it("should detect Arabic script", () => {
      expect(strictDetector.detect("مرحبا بالعالم").lang).toBe("ara");
    });

    it("should detect Hindi by Devanagari script", () => {
      expect(strictDetector.detect("नमस्ते दुनिया").lang).toBe("hin");
    });

    it("should detect Bengali script", () => {
      expect(strictDetector.detect("বাংলা পাঠ্য").lang).toBe("ben");
    });

    it("should detect Thai script", () => {
      expect(strictDetector.detect("สวัสดีชาวโลก").lang).toBe("tha");
    });

    it("should detect Russian by Cyrillic script", () => {
      expect(strictDetector.detect("Привет мир").lang).toBe("rus");
    });
  });
});
