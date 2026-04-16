import { describe, it, expect } from "vitest";
import { estimateTokens } from "../../src/utils/tokens.js";

describe("estimateTokens", () => {
  it("should return 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("should estimate ~0.25 tokens per Latin/ASCII character", () => {
    // 8 ASCII chars → 8 × 0.25 = 2.0 tokens
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("should estimate ~1.5 tokens per CJK character", () => {
    // 4 CJK Unified Ideographs → 4 × 1.5 = 6 tokens
    expect(estimateTokens("漢字テスト")).toBe(8); // 2 kanji (3.0) + 3 katakana (4.5) = 7.5 → 8
  });

  it("should estimate ~1.5 tokens per Hiragana character", () => {
    // 4 Hiragana chars → 4 × 1.5 = 6
    expect(estimateTokens("あいうえ")).toBe(6);
  });

  it("should estimate ~1.5 tokens per Katakana character", () => {
    // 4 Katakana chars → 4 × 1.5 = 6
    expect(estimateTokens("アイウエ")).toBe(6);
  });

  it("should estimate ~1.5 tokens per Hangul Syllable character", () => {
    // 4 Hangul Syllables → 4 × 1.5 = 6
    expect(estimateTokens("한국어테")).toBe(6);
  });

  it("should estimate ~0.5 tokens per Cyrillic character", () => {
    // 8 Cyrillic chars → 8 × 0.5 = 4
    expect(estimateTokens("Привет!!")).toBe(4); // 6 Cyrillic (3.0) + 2 ASCII (0.5) = 3.5 → 4
  });

  it("should estimate ~1.2 tokens per Arabic character", () => {
    // 5 Arabic chars → 5 × 1.2 = 6
    expect(estimateTokens("مرحبا")).toBe(6);
  });

  it("should estimate ~1.5 tokens per Devanagari character", () => {
    // "नमस्ते" has 6 code units in Devanagari range (0x0900-0x097F)
    const text = "नमस्ते";
    const result = estimateTokens(text);
    // All chars in Devanagari range → each × 1.5
    expect(result).toBeGreaterThan(0);
    // Verify it uses the 1.5 multiplier (Devanagari/Bengali range)
    expect(result).toBe(Math.round(text.length * 1.5));
  });

  it("should estimate ~1.5 tokens per Bengali character", () => {
    // Bengali script (0x0980-0x09FF) uses the same 1.5 multiplier
    const text = "বাংলা";
    const result = estimateTokens(text);
    expect(result).toBe(Math.round(text.length * 1.5));
  });

  it("should estimate ~1.0 tokens per Thai character", () => {
    // Thai script (0x0E00-0x0E7F)
    const text = "สวัสดี";
    const result = estimateTokens(text);
    expect(result).toBe(Math.round(text.length * 1.0));
  });

  it("should handle mixed scripts correctly", () => {
    // "Hello" (5 ASCII × 0.25 = 1.25) + "世界" (2 CJK × 1.5 = 3.0) = 4.25 → 4
    expect(estimateTokens("Hello世界")).toBe(4);
  });

  it("should treat characters outside known ranges as Latin (~0.25)", () => {
    // Characters above the known script ranges fall into the else → 0.25
    // Georgian (U+10D0-U+10FF) is outside all checked ranges
    const georgian = "\u10D0\u10D1\u10D2\u10D3"; // 4 chars × 0.25 = 1
    expect(estimateTokens(georgian)).toBe(1);
  });
});
