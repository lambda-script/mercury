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
    it("should respect custom minimum length", () => {
      const strictDetector = createFrancDetector(100);
      // Text under 100 chars should be treated as undetermined
      const result = strictDetector.detect("これは短いテキストです。");
      expect(result.lang).toBe("und");
    });
  });
});
