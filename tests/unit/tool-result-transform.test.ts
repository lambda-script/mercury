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

  it("should handle invalid JSON that starts with { or [", async () => {
    // Text that looks like JSON but isn't valid — should fall through to plain text
    const invalidJson = '{"broken json without closing brace';
    const result = {
      content: [{ type: "text" as const, text: invalidJson }],
    };

    const { content, stats } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const transformed = content as typeof result;
    expect(transformed.content[0].text).toBe(`[EN] ${invalidJson}`);
    expect(stats.blocksTranslated).toBe(1);
  });

  it("should handle JSON exceeding MAX_JSON_CHECK_BYTES (64KB)", async () => {
    // Create JSON-like text over 64KB — tryParseJson should skip it, treat as plain text
    const bigJsonLike = "{" + "x".repeat(65 * 1024) + "}";
    const result = {
      content: [{ type: "text" as const, text: bigJsonLike }],
    };

    const { content, stats } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const transformed = content as typeof result;
    expect(transformed.content[0].text).toBe(`[EN] ${bigJsonLike}`);
    expect(stats.blocksTranslated).toBe(1);
  });

  it("should stop translating at MAX_JSON_DEPTH (50)", async () => {
    // Build deeply nested JSON structure (> 50 levels)
    const longText = "これは深くネストされたテキストです。翻訳が必要な文字列です。";
    let nested: unknown = longText;
    for (let i = 0; i < 55; i++) {
      nested = { child: nested };
    }
    const deepJson = JSON.stringify(nested);
    const result = {
      content: [{ type: "text" as const, text: deepJson }],
    };

    const translator = createMockTranslator();
    await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    // The deepest string should NOT be translated because depth > 50
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("should skip structural strings in JSON (URLs, paths, dates, identifiers)", async () => {
    const jsonText = JSON.stringify({
      url: "https://example.com/api/v1",
      path: "/usr/local/bin/test",
      date: "2024-01-15T10:30:00Z",
      short_id: "abc123",
      description: "これは翻訳すべき長いテキストです。構造的な文字列ではありません。",
    });
    const result = {
      content: [{ type: "text" as const, text: jsonText }],
    };

    const translator = createMockTranslator();
    const { stats } = await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    // Only the description should be translated
    expect(translator.translate).toHaveBeenCalledTimes(1);
    expect(stats.blocksTranslated).toBe(1);
  });

  it("should skip code blocks inside JSON string values", async () => {
    const codeBlock = "```python\nprint('hello')\n```";
    const jsonText = JSON.stringify({
      code: codeBlock,
      description: "これは翻訳すべき長いテキストです。コードブロックではありません。",
    });
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

    // Only description should be translated, not the code block
    expect(translator.translate).toHaveBeenCalledTimes(1);
  });

  it("should pass through numbers, booleans, null in JSON", async () => {
    const jsonText = JSON.stringify({
      count: 42,
      active: true,
      value: null,
      description: "これは翻訳すべき長いテキストです。数値やブール値ではありません。",
    });
    const result = {
      content: [{ type: "text" as const, text: jsonText }],
    };

    const { content } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const transformed = content as typeof result;
    const parsed = JSON.parse(transformed.content[0].text);
    expect(parsed.count).toBe(42);
    expect(parsed.active).toBe(true);
    expect(parsed.value).toBeNull();
  });

  it("should pass through resource content blocks", async () => {
    const result = {
      content: [
        { type: "resource" as const, resource: { uri: "file:///test", text: "テスト" } },
        { type: "text" as const, text: "翻訳するテキスト" },
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
      resource: { uri: "file:///test", text: "テスト" },
    });
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
