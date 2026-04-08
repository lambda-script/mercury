import { describe, it, expect, vi } from "vitest";
import { transformToolResult, formatTransformStats, type TransformStats } from "../../src/transform/tool-result.js";
import type { Detector } from "../../src/detector/index.js";
import type { Translator } from "../../src/translator/index.js";

function createMockDetector(isTarget: boolean = false): Detector {
  return {
    detect: vi.fn(() => ({ lang: isTarget ? "eng" : "jpn", confidence: 1 })),
    isTargetLang: vi.fn(() => isTarget),
  };
}

function createMockTranslator(): Translator {
  return {
    translate: vi.fn(async (text: string) => `[EN] ${text}`),
  };
}

describe("transformToolResult", () => {
  it("should translate text content blocks", async () => {
    const result = {
      content: [{ type: "text" as const, text: "これはテストです" }],
    };

    const { content, stats } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const transformed = content as typeof result;
    expect(transformed.content[0].text).toBe("[EN] これはテストです");
    expect(stats.blocksTranslated).toBe(1);
    expect(stats.detectedLang).toBe("jpn");
  });

  it("should skip translation for English text", async () => {
    const result = {
      content: [{ type: "text" as const, text: "This is English" }],
    };

    const translator = createMockTranslator();
    const { content, stats } = await transformToolResult(
      result,
      createMockDetector(true),
      translator,
      "en",
    );

    const transformed = content as typeof result;
    expect(transformed.content[0].text).toBe("This is English");
    expect(stats.blocksSkipped).toBe(1);
    expect(stats.blocksTranslated).toBe(0);
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("should skip short strings inside JSON", async () => {
    const jsonText = '{"key": "value", "number": 42}';
    const result = {
      content: [{ type: "text" as const, text: jsonText }],
    };

    const translator = createMockTranslator();
    await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    // "value" is too short (< 20 chars) to translate
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("should translate long strings inside JSON", async () => {
    const longJaText = "これは長い日本語のテキストです。翻訳される必要があります。";
    const jsonText = JSON.stringify({ url: "https://example.com", body_md: longJaText });
    const result = {
      content: [{ type: "text" as const, text: jsonText }],
    };

    const { content, stats } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const transformed = content as typeof result;
    const parsed = JSON.parse(transformed.content[0].text);
    // URL should be preserved, body_md should be translated
    expect(parsed.url).toBe("https://example.com");
    expect(parsed.body_md).toBe(`[EN] ${longJaText}`);
    expect(stats.blocksTranslated).toBe(1);
  });

  it("should skip code blocks", async () => {
    const codeText = "```typescript\nconst x = 1;\n```";
    const result = {
      content: [{ type: "text" as const, text: codeText }],
    };

    const translator = createMockTranslator();
    const { stats } = await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    expect(stats.blocksSkipped).toBe(1);
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("should translate multiple text blocks", async () => {
    const result = {
      content: [
        { type: "text" as const, text: "最初のブロック" },
        { type: "text" as const, text: "二番目のブロック" },
      ],
    };

    const { content, stats } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const transformed = content as typeof result;
    expect(transformed.content[0].text).toBe("[EN] 最初のブロック");
    expect(transformed.content[1].text).toBe("[EN] 二番目のブロック");
    expect(stats.blocksTranslated).toBe(2);
  });

  it("should pass through image content blocks", async () => {
    const result = {
      content: [
        { type: "image" as const, data: "base64data", mimeType: "image/png" },
        { type: "text" as const, text: "画像の説明" },
      ],
    };

    const { content } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const transformed = content as typeof result;
    expect(transformed.content[0]).toEqual({
      type: "image",
      data: "base64data",
      mimeType: "image/png",
    });
    expect(transformed.content[1].text).toBe("[EN] 画像の説明");
  });

  it("should pass through error results without translation", async () => {
    const result = {
      content: [{ type: "text" as const, text: "エラーメッセージ" }],
      isError: true,
    };

    const translator = createMockTranslator();
    const { content } = await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    expect(content).toBe(result);
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("should handle null/undefined result", async () => {
    const { content: c1 } = await transformToolResult(
      null,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );
    expect(c1).toBeNull();

    const { content: c2 } = await transformToolResult(
      undefined,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );
    expect(c2).toBeUndefined();
  });

  it("should handle result without content array", async () => {
    const result = { someField: "value" };

    const { content } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    expect(content).toEqual(result);
  });

  it("should preserve other fields in the result", async () => {
    const result = {
      content: [{ type: "text" as const, text: "テスト" }],
      _meta: { requestId: "123" },
    };

    const { content } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const transformed = content as Record<string, unknown>;
    expect(transformed._meta).toEqual({ requestId: "123" });
  });

  it("should translate strings in JSON arrays", async () => {
    const longJaText = "これは配列内の長い日本語テキストです。翻訳が必要です。";
    const jsonArray = JSON.stringify([{ id: 1, name: longJaText }]);
    const result = {
      content: [{ type: "text" as const, text: jsonArray }],
    };

    const { content, stats } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const transformed = content as typeof result;
    const parsed = JSON.parse(transformed.content[0].text);
    expect(parsed[0].name).toBe(`[EN] ${longJaText}`);
    expect(stats.blocksTranslated).toBe(1);
  });

  it("should not exceed max recursion depth on deeply nested JSON", async () => {
    // Build JSON nested ~60 levels deep (> MAX_JSON_DEPTH of 50)
    let deep: unknown = "これは深い場所にある日本語テキストです。翻訳します。";
    for (let i = 0; i < 60; i++) {
      deep = { nested: deep };
    }
    const result = {
      content: [{ type: "text" as const, text: JSON.stringify(deep) }],
    };

    const translator = createMockTranslator();
    // Should not throw / stack overflow
    const { content } = await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    expect(content).toBeDefined();
    // The deepest string was beyond MAX_JSON_DEPTH so it should NOT be translated
    const transformed = content as typeof result;
    const reparsed = JSON.parse(transformed.content[0].text) as Record<string, unknown>;
    let probe: unknown = reparsed;
    for (let i = 0; i < 60; i++) {
      probe = (probe as { nested: unknown }).nested;
    }
    expect(probe).not.toContain("[EN]");
  });

  it("should fall back to plain-text translation when JSON.parse fails", async () => {
    // Starts with '{' so tryParseJson attempts JSON.parse, but content is invalid JSON.
    // The translator should still receive the whole text as a plain block.
    const text = "{ not valid json これは長い日本語テキストの段落です。";
    const result = {
      content: [{ type: "text" as const, text }],
    };

    const translator = createMockTranslator();
    const { content, stats } = await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    expect(translator.translate).toHaveBeenCalledTimes(1);
    expect(translator.translate).toHaveBeenCalledWith(text, "auto", "en");
    const transformed = content as typeof result;
    expect(transformed.content[0].text).toBe(`[EN] ${text}`);
    expect(stats.blocksTranslated).toBe(1);
  });

  it("should treat oversized JSON-like text as plain text (skip parse)", async () => {
    // > 64KB bypasses JSON.parse heuristic and is handled as plain text
    const big = "{ " + "これは大きなテキストブロックです。".repeat(5000) + " }";
    expect(big.length).toBeGreaterThan(64 * 1024);
    const result = {
      content: [{ type: "text" as const, text: big }],
    };

    const translator = createMockTranslator();
    await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    // Translated as a single plain-text block, not walked as JSON
    expect(translator.translate).toHaveBeenCalledTimes(1);
    expect(translator.translate).toHaveBeenCalledWith(big, "auto", "en");
  });

  it("should preserve URLs, file paths, ISO dates and short identifiers in JSON", async () => {
    // All these strings are >= 20 chars but match isStructuralString rules.
    const json = JSON.stringify({
      url: "https://example.com/path/to/something/long",
      filePath: "/var/log/application/very-long-filename.log",
      date: "2024-01-15T12:34:56.000Z",
      shortId: "abc-def",
      body: "これは翻訳されるべき長い日本語の本文です。",
    });
    const result = {
      content: [{ type: "text" as const, text: json }],
    };

    const translator = createMockTranslator();
    const { content } = await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    // Only `body` should have been translated
    expect(translator.translate).toHaveBeenCalledTimes(1);
    const transformed = content as typeof result;
    const parsed = JSON.parse(transformed.content[0].text);
    expect(parsed.url).toBe("https://example.com/path/to/something/long");
    expect(parsed.filePath).toBe("/var/log/application/very-long-filename.log");
    expect(parsed.date).toBe("2024-01-15T12:34:56.000Z");
    expect(parsed.shortId).toBe("abc-def");
    expect(parsed.body).toBe("[EN] これは翻訳されるべき長い日本語の本文です。");
  });

  it("should handle whitespace-prefixed JSON arrays", async () => {
    const longJaText = "これは配列の中の長い日本語のテキストです。";
    const jsonText = "  \n  " + JSON.stringify([longJaText]);
    const result = {
      content: [{ type: "text" as const, text: jsonText }],
    };

    const { content, stats } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    expect(stats.blocksTranslated).toBe(1);
    const transformed = content as typeof result;
    const parsed = JSON.parse(transformed.content[0].text);
    expect(parsed[0]).toBe(`[EN] ${longJaText}`);
  });

  it("should leave detectedLang null when detector reports zero confidence", async () => {
    const detector: Detector = {
      detect: vi.fn(() => ({ lang: "und", confidence: 0 })),
      isTargetLang: vi.fn(() => false),
    };

    const result = {
      content: [{ type: "text" as const, text: "これは長い日本語のテキストです。" }],
    };

    const { stats } = await transformToolResult(
      result,
      detector,
      createMockTranslator(),
      "en",
    );

    expect(stats.detectedLang).toBeNull();
    expect(stats.blocksTranslated).toBe(1);
  });

  it("should accumulate stats across multiple text blocks and only set detectedLang once", async () => {
    let callCount = 0;
    const detector: Detector = {
      detect: vi.fn(() => {
        callCount += 1;
        // First call says jpn, subsequent say something else — first wins
        return callCount === 1
          ? { lang: "jpn", confidence: 1 }
          : { lang: "kor", confidence: 1 };
      }),
      isTargetLang: vi.fn(() => false),
    };

    const result = {
      content: [
        { type: "text" as const, text: "これは最初の長い日本語ブロックです。" },
        { type: "text" as const, text: "これは二番目の長い日本語ブロックです。" },
      ],
    };

    const { stats } = await transformToolResult(
      result,
      detector,
      createMockTranslator(),
      "en",
    );

    expect(stats.blocksTranslated).toBe(2);
    expect(stats.detectedLang).toBe("jpn");
    expect(stats.charsOriginal).toBeGreaterThan(0);
    expect(stats.tokensOriginal).toBeGreaterThan(0);
  });

  it("should pass through resource content blocks unchanged", async () => {
    const result = {
      content: [
        {
          type: "resource" as const,
          resource: { uri: "file:///x", mimeType: "text/plain" },
        },
        { type: "text" as const, text: "これは長いリソースの説明テキストです。" },
      ],
    };

    const { content } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const transformed = content as typeof result;
    expect(transformed.content[0]).toEqual({
      type: "resource",
      resource: { uri: "file:///x", mimeType: "text/plain" },
    });
    expect((transformed.content[1] as { text: string }).text).toContain("[EN]");
  });

  it("should handle JSON value that is just a long bare string", async () => {
    // JSON.parse('"..."') returns a string, but our heuristic only enters JSON
    // mode for text starting with { or [, so this is handled as plain text.
    const text = '"これは長い日本語のテキストです。翻訳されるべきです。"';
    const result = {
      content: [{ type: "text" as const, text }],
    };

    const translator = createMockTranslator();
    await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    // Should translate the whole quoted string as plain text
    expect(translator.translate).toHaveBeenCalledWith(text, "auto", "en");
  });
});

describe("formatTransformStats", () => {
  it("should format stats with translation", () => {
    const stats: TransformStats = {
      blocksTranslated: 2,
      blocksSkipped: 1,
      charsOriginal: 100,
      charsTransformed: 80,
      tokensOriginal: 150,
      tokensTransformed: 20,
      detectedLang: "jpn",
    };

    const formatted = formatTransformStats(stats);
    expect(formatted).toContain("Japanese");
    expect(formatted).toContain("2 blocks");
    expect(formatted).toContain("1 skipped");
    expect(formatted).toContain("150");
    expect(formatted).toContain("20");
  });

  it("should format stats when no translation needed", () => {
    const stats: TransformStats = {
      blocksTranslated: 0,
      blocksSkipped: 3,
      charsOriginal: 0,
      charsTransformed: 0,
      tokensOriginal: 0,
      tokensTransformed: 0,
      detectedLang: null,
    };

    const formatted = formatTransformStats(stats);
    expect(formatted).toContain("No translation needed");
    expect(formatted).toContain("3 blocks skipped");
  });
});
