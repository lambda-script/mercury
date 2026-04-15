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

  describe("cache", () => {
    it("should return cached result when detect is called twice with same text", () => {
      const det = createFrancDetector(20);
      const text = "これは日本語のテストテキストです。翻訳が必要です。";

      const first = det.detect(text);
      const second = det.detect(text);

      // Same reference — returned from cache, not recomputed
      expect(second).toBe(first);
      expect(second.lang).toBe("jpn");
    });

    it("should invalidate cache when different text is detected", () => {
      const det = createFrancDetector(20);

      const jpn = det.detect("これは日本語のテストテキストです。翻訳が必要です。");
      expect(jpn.lang).toBe("jpn");

      const eng = det.detect("This is an English sentence for language detection testing.");
      expect(eng.lang).toBe("eng");

      // Original text should no longer be cached
      const jpn2 = det.detect("これは日本語のテストテキストです。翻訳が必要です。");
      expect(jpn2.lang).toBe("jpn");
      // Not the same reference as first call (cache was invalidated)
      expect(jpn2).not.toBe(jpn);
    });
  });

  describe("kana override", () => {
    it("should override franc's cmn to jpn when kana is present", () => {
      // Kanji-heavy text with some kana: franc may return "cmn" but kana proves Japanese
      const det = createFrancDetector(10);
      const text = "漢字漢字漢字漢字の漢字漢字漢字漢字を読む漢字漢字漢字漢字";
      const result = det.detect(text);
      // The kana override should fire: either franc returns jpn directly
      // or franc returns cmn and the kana override corrects it
      expect(result.lang).toBe("jpn");
    });
  });

  describe("script detection patterns", () => {
    it("should detect Korean script in short text", () => {
      const det = createFrancDetector(100);
      const result = det.detect("한글");
      expect(result.lang).toBe("kor");
      expect(result.confidence).toBe(1);
    });

    it("should detect CJK (Chinese) in short text without kana", () => {
      const det = createFrancDetector(100);
      const result = det.detect("漢字");
      expect(result.lang).toBe("cmn");
      expect(result.confidence).toBe(1);
    });

    it("should detect Arabic script in short text", () => {
      const det = createFrancDetector(100);
      const result = det.detect("مرحبا");
      expect(result.lang).toBe("ara");
      expect(result.confidence).toBe(1);
    });

    it("should detect Devanagari script in short text", () => {
      const det = createFrancDetector(100);
      const result = det.detect("नमस्ते");
      expect(result.lang).toBe("hin");
      expect(result.confidence).toBe(1);
    });

    it("should detect Bengali script in short text", () => {
      const det = createFrancDetector(100);
      const result = det.detect("বাংলা");
      expect(result.lang).toBe("ben");
      expect(result.confidence).toBe(1);
    });

    it("should detect Thai script in short text", () => {
      const det = createFrancDetector(100);
      const result = det.detect("สวัสดี");
      expect(result.lang).toBe("tha");
      expect(result.confidence).toBe(1);
    });

    it("should detect Cyrillic script in short text", () => {
      const det = createFrancDetector(100);
      const result = det.detect("Привет");
      expect(result.lang).toBe("rus");
      expect(result.confidence).toBe(1);
    });
  });

  describe("isTargetLang edge cases", () => {
    it("should return true for short text matching the target script", () => {
      const det = createFrancDetector(100);
      // Short Japanese text, target is jpn → script matches target
      expect(det.isTargetLang("こんにちは", "jpn")).toBe(true);
    });

    it("should return false for short text not matching the target script", () => {
      const det = createFrancDetector(100);
      // Short Japanese text, target is eng → script does not match
      expect(det.isTargetLang("こんにちは", "eng")).toBe(false);
    });

    it("should return true when franc returns undetermined for longer text", () => {
      const det = createFrancDetector(5);
      // Punctuation/numbers only — franc should return undetermined
      expect(det.isTargetLang("1234567890 - 0987654321 / 1234567890", "eng")).toBe(true);
    });

    it("should use detect() cache in isTargetLang for longer text", () => {
      const det = createFrancDetector(20);
      const text = "これは日本語のテストテキストです。翻訳が必要です。";

      // First detect to populate cache
      const detected = det.detect(text);
      expect(detected.lang).toBe("jpn");

      // isTargetLang should use the cached detect result
      expect(det.isTargetLang(text, "jpn")).toBe(true);
      expect(det.isTargetLang(text, "eng")).toBe(false);
    });

    it("should accept ISO 639-1 codes via toIso3 conversion", () => {
      const det = createFrancDetector(20);
      // "en" should be converted to "eng" internally
      expect(
        det.isTargetLang("This is an English sentence for language detection testing.", "en"),
      ).toBe(true);
    });
  });
});
