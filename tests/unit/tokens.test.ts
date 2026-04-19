import { describe, it, expect } from "vitest";
import { estimateTokens } from "../../src/utils/tokens.js";

describe("estimateTokens", () => {
  it("should return 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("should estimate Latin/ASCII at ~0.25 tokens per char", () => {
    const text = "Hello world";
    const tokens = estimateTokens(text);
    expect(tokens).toBe(Math.round(text.length * 0.25));
  });

  it("should estimate CJK characters at ~1.5 tokens per char", () => {
    const text = "\u4F60\u597D\u4E16\u754C"; // 你好世界
    expect(estimateTokens(text)).toBe(Math.round(4 * 1.5));
  });

  it("should estimate Hiragana at ~1.5 tokens per char", () => {
    const text = "\u3053\u3093\u306B\u3061\u306F"; // こんにちは
    expect(estimateTokens(text)).toBe(Math.round(5 * 1.5));
  });

  it("should estimate Katakana at ~1.5 tokens per char", () => {
    const text = "\u30C6\u30B9\u30C8"; // テスト
    expect(estimateTokens(text)).toBe(Math.round(3 * 1.5));
  });

  it("should estimate Hangul at ~1.5 tokens per char", () => {
    const text = "\uC548\uB155\uD558\uC138\uC694"; // 안녕하세요
    expect(estimateTokens(text)).toBe(Math.round(5 * 1.5));
  });

  it("should estimate Cyrillic at ~0.5 tokens per char", () => {
    const text = "\u041F\u0440\u0438\u0432\u0435\u0442"; // Привет
    expect(estimateTokens(text)).toBe(Math.round(6 * 0.5));
  });

  it("should estimate Arabic at ~1.2 tokens per char", () => {
    const text = "\u0645\u0631\u062D\u0628\u0627"; // مرحبا
    expect(estimateTokens(text)).toBe(Math.round(5 * 1.2));
  });

  it("should estimate Devanagari at ~1.5 tokens per char", () => {
    const text = "\u0928\u092E\u0938\u094D\u0924\u0947"; // नमस्ते
    expect(estimateTokens(text)).toBe(Math.round(6 * 1.5));
  });

  it("should estimate Bengali at ~1.5 tokens per char", () => {
    const text = "\u09B8\u09CD\u09AC\u09BE\u0997\u09A4\u09AE"; // স্বাগতম
    expect(estimateTokens(text)).toBe(Math.round(7 * 1.5));
  });

  it("should estimate Thai at ~1.0 tokens per char", () => {
    const text = "\u0E2A\u0E27\u0E31\u0E2A\u0E14\u0E35"; // สวัสดี
    expect(estimateTokens(text)).toBe(Math.round(6 * 1.0));
  });

  it("should handle mixed scripts", () => {
    // "Hello" (5 Latin) + "世界" (2 CJK)
    const text = "Hello\u4E16\u754C";
    const expected = Math.round(5 * 0.25 + 2 * 1.5);
    expect(estimateTokens(text)).toBe(expected);
  });

  it("should treat unknown high-range codepoints as Latin-cost", () => {
    // Armenian (U+0531) falls outside all specific ranges → 0.25 fallback
    const text = "\u0531\u0532\u0533\u0534";
    expect(estimateTokens(text)).toBe(Math.round(4 * 0.25));
  });
});
