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

  it("should stop walking when JSON nesting exceeds max depth", async () => {
    // Build deeply nested object: { a: { a: { a: ... } } } 60 levels deep
    // (max depth is 50)
    type Nested = { a?: Nested; leaf?: string };
    let nested: Nested = {
      leaf: "これは深くネストされた日本語のテキストです。翻訳されるはずでした。",
    };
    for (let i = 0; i < 60; i++) {
      nested = { a: nested };
    }
    const jsonText = JSON.stringify(nested);

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

    // Walker bails out before reaching the leaf — no translation calls
    expect(translator.translate).not.toHaveBeenCalled();
    expect(stats.blocksTranslated).toBe(0);
  });

  it("should fall back to plain-text translation for malformed JSON", async () => {
    // Looks like JSON (starts with `{`) but is malformed → tryParseJson returns null
    // → falls through to translatePlainText
    const malformed = "{ this is not actually json but starts with a brace";
    const result = {
      content: [{ type: "text" as const, text: malformed }],
    };

    const translator = createMockTranslator();
    const { content, stats } = await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    const transformed = content as typeof result;
    expect(transformed.content[0].text).toBe(`[EN] ${malformed}`);
    expect(stats.blocksTranslated).toBe(1);
    expect(translator.translate).toHaveBeenCalledOnce();
  });

  it("should treat whitespace-only text as already-target-lang", async () => {
    const result = {
      content: [{ type: "text" as const, text: "   \n\t  " }],
    };

    // Detector says it's the target language
    const translator = createMockTranslator();
    const { stats } = await transformToolResult(
      result,
      createMockDetector(true),
      translator,
      "en",
    );

    expect(translator.translate).not.toHaveBeenCalled();
    expect(stats.blocksSkipped).toBe(1);
  });

  it("should handle empty content array", async () => {
    const result = { content: [] };
    const translator = createMockTranslator();
    const { content, stats } = await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    expect((content as typeof result).content).toEqual([]);
    expect(stats.blocksTranslated).toBe(0);
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("should leave numbers, booleans, and null in JSON untouched", async () => {
    const longJa = "これは長い日本語のテキストです。翻訳が必要です。";
    const jsonText = JSON.stringify({
      count: 42,
      active: true,
      missing: null,
      tags: [1, 2, false, null],
      message: longJa,
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

    const parsed = JSON.parse((content as typeof result).content[0].text);
    expect(parsed.count).toBe(42);
    expect(parsed.active).toBe(true);
    expect(parsed.missing).toBeNull();
    expect(parsed.tags).toEqual([1, 2, false, null]);
    expect(parsed.message).toBe(`[EN] ${longJa}`);
  });

  it("should not attempt JSON parse on text larger than 64KB", async () => {
    // > 64KB: tryParseJson returns null without parsing, falls through to plain text
    const longJa = "これは長い日本語のテキストです。".repeat(10);
    // Build a JSON-looking string that exceeds the parse limit
    const huge = "{" + " ".repeat(70 * 1024) + "}";

    const result = {
      content: [{ type: "text" as const, text: huge + longJa }],
    };

    const translator = createMockTranslator();
    await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    // Falls through to plain text path — translator IS called once for the whole block
    expect(translator.translate).toHaveBeenCalledOnce();
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
