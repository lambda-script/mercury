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

  it("should translate strings inside nested JSON objects", async () => {
    const longJaText = "これはネストされた日本語テキストです。翻訳が必要です。";
    const jsonText = JSON.stringify({
      outer: { inner: { deep: longJaText } },
    });
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
    expect(parsed.outer.inner.deep).toBe(`[EN] ${longJaText}`);
    expect(stats.blocksTranslated).toBe(1);
  });

  it("should preserve key order when walking JSON objects", async () => {
    const longJaText = "これは長い日本語のテキストです。翻訳が必要です。テスト用。";
    const jsonText = JSON.stringify({
      z_first: longJaText,
      a_second: longJaText,
      m_third: longJaText,
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
    const parsed = JSON.parse(transformed.content[0].text) as Record<string, string>;
    expect(Object.keys(parsed)).toEqual(["z_first", "a_second", "m_third"]);
  });

  it("should stop recursion at the maximum JSON depth", async () => {
    // Build a value deeper than MAX_JSON_DEPTH (50). Use 60.
    type Nested = { next?: Nested; payload?: string };
    const longJaText = "これは深くネストされた日本語のテキストです。翻訳されるべきですが、深すぎる場合は翻訳されません。";
    let nested: Nested = { payload: longJaText };
    for (let i = 0; i < 60; i++) {
      nested = { next: nested };
    }
    const jsonText = JSON.stringify(nested);
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

    // The deeply nested payload should have been skipped due to depth cap.
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("should leave whitespace-only text untouched (firstNonWsIndex full scan)", async () => {
    const result = {
      content: [{ type: "text" as const, text: "   \n\t  \r" }],
    };

    const translator = createMockTranslator();
    const { content } = await transformToolResult(
      result,
      // isTargetLang(true) so plain-text path returns early without invoking the translator
      createMockDetector(true),
      translator,
      "en",
    );

    const transformed = content as typeof result;
    expect(transformed.content[0].text).toBe("   \n\t  \r");
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("should fall back to plain-text path when JSON.parse fails on a brace-prefixed string", async () => {
    // Starts with '{' so tryParseJson attempts a parse, but is malformed,
    // exercising the catch branch and forcing the plain-text path.
    const malformed = "{not valid json but starts with a brace and is long enough to translate";
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
    expect(translator.translate).toHaveBeenCalledTimes(1);
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
