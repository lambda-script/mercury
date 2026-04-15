import { describe, it, expect } from "vitest";
import { estimateTokens } from "../../src/utils/tokens.js";

describe("estimateTokens", () => {
  it("should return 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("should estimate Latin/ASCII text at ~0.25 tokens per char", () => {
    // 8 chars × 0.25 = 2.0 tokens
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("should estimate CJK Unified Ideographs at ~1.5 tokens per char", () => {
    // 4 CJK chars × 1.5 = 6.0 tokens
    expect(estimateTokens("漢字測試")).toBe(6);
  });

  it("should estimate Hiragana at ~1.5 tokens per char", () => {
    // 4 Hiragana × 1.5 = 6.0 tokens
    expect(estimateTokens("あいうえ")).toBe(6);
  });

  it("should estimate Katakana at ~1.5 tokens per char", () => {
    // 4 Katakana × 1.5 = 6.0 tokens
    expect(estimateTokens("アイウエ")).toBe(6);
  });

  it("should estimate Hangul Syllables at ~1.5 tokens per char", () => {
    // 4 Hangul × 1.5 = 6.0 tokens
    expect(estimateTokens("한글테스")).toBe(6);
  });

  it("should estimate Cyrillic at ~0.5 tokens per char", () => {
    // 4 Cyrillic chars × 0.5 = 2.0 tokens
    expect(estimateTokens("АБВГ")).toBe(2);
    // Lowercase too
    expect(estimateTokens("абвг")).toBe(2);
  });

  it("should estimate Arabic at ~1.2 tokens per char", () => {
    // 5 Arabic chars × 1.2 = 6.0 tokens
    expect(estimateTokens("مرحبا")).toBe(6);
  });

  it("should estimate Devanagari at ~1.5 tokens per char", () => {
    // 4 Devanagari chars × 1.5 = 6.0 tokens
    expect(estimateTokens("नमस्")).toBe(6);
  });

  it("should estimate Bengali at ~1.5 tokens per char", () => {
    // 4 Bengali chars × 1.5 = 6.0 tokens
    expect(estimateTokens("বাংল")).toBe(6);
  });

  it("should estimate Thai at ~1.0 tokens per char", () => {
    // 4 Thai chars × 1.0 = 4.0 tokens
    expect(estimateTokens("สวัส")).toBe(4);
  });

  it("should use 0.25 fallback for other Unicode (e.g. Greek)", () => {
    // Greek is outside all specific ranges → 0.25 per char
    // 4 Greek chars × 0.25 = 1.0 tokens
    expect(estimateTokens("αβγδ")).toBe(1);
  });

  it("should handle mixed scripts correctly", () => {
    // "Hello" = 5 Latin × 0.25 = 1.25
    // "世界" = 2 CJK × 1.5 = 3.0
    // Total = 4.25, rounds to 4
    expect(estimateTokens("Hello世界")).toBe(4);
  });

  it("should count punctuation and spaces as Latin/ASCII", () => {
    // "a, b." = 5 chars × 0.25 = 1.25 → rounds to 1
    expect(estimateTokens("a, b.")).toBe(1);
  });

  it("should handle CJK with interspersed ASCII punctuation", () => {
    // "漢字、漢字" = 2 CJK + 1 punct(0x3001, fallback 0.25) + 2 CJK
    // = 3.0 + 0.25 + 3.0 = 6.25 → 6
    expect(estimateTokens("漢字、漢字")).toBe(6);
  });

  it("should round to nearest integer", () => {
    // 3 Latin chars × 0.25 = 0.75 → rounds to 1
    expect(estimateTokens("abc")).toBe(1);
    // 1 Latin char × 0.25 = 0.25 → rounds to 0
    expect(estimateTokens("a")).toBe(0);
    // 2 Latin chars × 0.25 = 0.50 → rounds to 1 (banker's rounding: 0.5 rounds to 0 in some implementations)
    // Math.round(0.5) = 1 in JS
    expect(estimateTokens("ab")).toBe(1);
  });
});
