import { describe, it, expect } from "vitest";
import { estimateTokens } from "../../src/utils/tokens.js";

describe("estimateTokens", () => {
  it("should return 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("should estimate Latin/ASCII at ~0.25 tokens per char", () => {
    // 8 ASCII chars → 8 * 0.25 = 2
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("should estimate CJK ideographs at ~1.5 tokens per char", () => {
    // 4 CJK chars → 4 * 1.5 = 6
    expect(estimateTokens("漢字漢字")).toBe(6);
  });

  it("should estimate Hiragana at ~1.5 tokens per char", () => {
    // 4 Hiragana chars → 4 * 1.5 = 6
    expect(estimateTokens("あいうえ")).toBe(6);
  });

  it("should estimate Katakana at ~1.5 tokens per char", () => {
    // 4 Katakana chars → 4 * 1.5 = 6
    expect(estimateTokens("アイウエ")).toBe(6);
  });

  it("should estimate Hangul at ~1.5 tokens per char", () => {
    // 4 Hangul chars → 4 * 1.5 = 6
    expect(estimateTokens("가나다라")).toBe(6);
  });

  it("should estimate Cyrillic at ~0.5 tokens per char", () => {
    // 4 Cyrillic chars → 4 * 0.5 = 2
    expect(estimateTokens("абвг")).toBe(2);
  });

  it("should estimate Arabic at ~1.2 tokens per char", () => {
    // 5 Arabic chars → 5 * 1.2 = 6
    expect(estimateTokens("مرحبا")).toBe(6);
  });

  it("should estimate Devanagari at ~1.5 tokens per char", () => {
    // 4 Devanagari chars → 4 * 1.5 = 6
    expect(estimateTokens("नमस्")).toBe(6);
  });

  it("should estimate Bengali at ~1.5 tokens per char", () => {
    // 4 Bengali chars → 4 * 1.5 = 6
    expect(estimateTokens("বাংল")).toBe(6);
  });

  it("should estimate Thai at ~1.0 tokens per char", () => {
    // 4 Thai chars → 4 * 1.0 = 4
    expect(estimateTokens("สวัส")).toBe(4);
  });

  it("should handle mixed scripts correctly", () => {
    // "Hello" (5 ASCII * 0.25 = 1.25) + "世界" (2 CJK * 1.5 = 3) = 4.25 → 4
    expect(estimateTokens("Hello世界")).toBe(4);
  });

  it("should treat characters outside known ranges as Latin (~0.25)", () => {
    // Georgian script (U+10D0 range) is outside all specific ranges
    // 4 chars → 4 * 0.25 = 1
    expect(estimateTokens("ⴀⴁⴂⴃ")).toBe(1);
  });
});
