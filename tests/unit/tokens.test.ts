import { describe, it, expect } from "vitest";
import { estimateTokens } from "../../src/utils/tokens.js";

describe("estimateTokens", () => {
  it("should return 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("should estimate Latin/ASCII text at ~0.25 tokens/char", () => {
    const text = "Hello, world!";
    const tokens = estimateTokens(text);
    expect(tokens).toBe(Math.round(text.length * 0.25));
  });

  it("should estimate CJK ideographs at ~1.5 tokens/char", () => {
    const text = "漢字テスト";
    const tokens = estimateTokens(text);
    expect(tokens).toBe(Math.round(text.length * 1.5));
  });

  it("should estimate Hiragana at ~1.5 tokens/char", () => {
    const text = "あいうえお";
    expect(estimateTokens(text)).toBe(Math.round(text.length * 1.5));
  });

  it("should estimate Katakana at ~1.5 tokens/char", () => {
    const text = "アイウエオ";
    expect(estimateTokens(text)).toBe(Math.round(text.length * 1.5));
  });

  it("should estimate Hangul syllables at ~1.5 tokens/char", () => {
    const text = "안녕하세요";
    expect(estimateTokens(text)).toBe(Math.round(text.length * 1.5));
  });

  it("should estimate Cyrillic text at ~0.5 tokens/char", () => {
    const text = "Привет";
    const tokens = estimateTokens(text);
    expect(tokens).toBe(Math.round(text.length * 0.5));
  });

  it("should estimate Arabic text at ~1.2 tokens/char", () => {
    const text = "مرحبا";
    const tokens = estimateTokens(text);
    expect(tokens).toBe(Math.round(text.length * 1.2));
  });

  it("should estimate Devanagari text at ~1.5 tokens/char", () => {
    const text = "नमस्ते";
    const tokens = estimateTokens(text);
    expect(tokens).toBe(Math.round(text.length * 1.5));
  });

  it("should estimate Bengali text at ~1.5 tokens/char", () => {
    const text = "স্বাগতম";
    const tokens = estimateTokens(text);
    expect(tokens).toBe(Math.round(text.length * 1.5));
  });

  it("should estimate Thai text at ~1.0 tokens/char", () => {
    const text = "สวัสดี";
    const tokens = estimateTokens(text);
    expect(tokens).toBe(Math.round(text.length * 1.0));
  });

  it("should handle mixed-script text correctly", () => {
    // "Hello" (5 Latin) + "世界" (2 CJK)
    const text = "Hello世界";
    const expected = Math.round(5 * 0.25 + 2 * 1.5);
    expect(estimateTokens(text)).toBe(expected);
  });

  it("should treat unknown scripts as Latin (0.25 tokens/char)", () => {
    // Georgian script (U+10D0-U+10FF), falls into the else branch
    const text = "\u10D0\u10D1\u10D2";
    expect(estimateTokens(text)).toBe(Math.round(3 * 0.25));
  });
});
