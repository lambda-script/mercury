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

  it("should preserve original JSON text when no strings were translated", async () => {
    // Compact, no whitespace — would be reformatted by JSON.stringify(_, null, 2).
    const jsonText = '{"key":"value","number":42}';
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
    // Identity preserved: no re-serialization, no whitespace changes.
    expect(transformed.content[0].text).toBe(jsonText);
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

  it("should translate sibling object values concurrently", async () => {
    const longTextA = "これは最初の長い日本語テキストです。並列で翻訳されます。";
    const longTextB = "二番目の長い日本語テキストも同時に翻訳されるはずです。";
    const longTextC = "三番目のテキストも並列に処理される必要があります。";
    const jsonText = JSON.stringify({ a: longTextA, b: longTextB, c: longTextC });
    const result = { content: [{ type: "text" as const, text: jsonText }] };

    // Translator that records the order it was invoked.
    const callOrder: string[] = [];
    const translator: Translator = {
      translate: vi.fn(async (text: string) => {
        callOrder.push(text);
        // Yield once so concurrent calls can interleave; if the walker were
        // sequential they would still be issued in order, but they would
        // each await before the next is even queued.
        await Promise.resolve();
        return `[EN] ${text}`;
      }),
    };

    const { content, stats } = await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    const transformed = content as typeof result;
    const parsed = JSON.parse(transformed.content[0].text);
    expect(parsed.a).toBe(`[EN] ${longTextA}`);
    expect(parsed.b).toBe(`[EN] ${longTextB}`);
    expect(parsed.c).toBe(`[EN] ${longTextC}`);
    expect(stats.blocksTranslated).toBe(3);
    // All three translate() invocations should have started before any
    // resolved — i.e. they were issued in a single tick.
    expect(callOrder).toEqual([longTextA, longTextB, longTextC]);
    expect(translator.translate).toHaveBeenCalledTimes(3);
  });

  it("should stop walking JSON when nesting exceeds max depth", async () => {
    // Build a deeply nested object: 60 levels (limit is 50).
    let nested: unknown = "これは深くネストされた長い日本語テキストです。翻訳されるべきではありません。";
    for (let i = 0; i < 60; i++) {
      nested = { level: nested };
    }
    const jsonText = JSON.stringify(nested);
    const result = { content: [{ type: "text" as const, text: jsonText }] };

    const translator = createMockTranslator();
    await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    // The string is past the depth limit, so the walker should bail out
    // before reaching it and translate() should never be invoked.
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("should treat malformed JSON as plain text and translate", async () => {
    // Starts with '{' so tryParseJsonObject *attempts* JSON.parse and hits the
    // catch path, then falls through to plain-text translation.
    const malformedJson = "{これは壊れたJSONですが、長い日本語のテキストです";
    const result = { content: [{ type: "text" as const, text: malformedJson }] };

    const { content, stats } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const transformed = content as typeof result;
    expect(transformed.content[0].text).toBe(`[EN] ${malformedJson}`);
    expect(stats.blocksTranslated).toBe(1);
  });

  it("should not attempt JSON parse on payloads above the size cap", async () => {
    // > 64KB of '[' followed by junk: short-circuits before JSON.parse even runs.
    const oversize = "[" + "x".repeat(70 * 1024);
    const result = { content: [{ type: "text" as const, text: oversize }] };

    // Mark as non-target so it falls through to plain-text translation.
    const { stats } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    expect(stats.blocksTranslated).toBe(1);
  });

  it("should skip long URLs inside JSON values", async () => {
    // Long URL (>20 chars) inside JSON: hits the isStructuralString branch
    // of shouldTranslateJsonString rather than the length early-return.
    const longUrl = "https://example.com/very/long/path/to/something";
    const longJaText = "これは長い日本語のテキストで、翻訳されるべきです。";
    const jsonText = JSON.stringify({ url: longUrl, body: longJaText });
    const result = { content: [{ type: "text" as const, text: jsonText }] };

    const { content } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const transformed = content as typeof result;
    const parsed = JSON.parse(transformed.content[0].text);
    expect(parsed.url).toBe(longUrl); // URL preserved verbatim
    expect(parsed.body).toBe(`[EN] ${longJaText}`);
  });

  it("should skip code blocks nested inside JSON values", async () => {
    // String inside JSON that starts with ``` exercises the isCodeBlock
    // branch of shouldTranslateJsonString.
    const codeStr = "```python\nprint('hello world')\nreturn 1\n```";
    const jsonText = JSON.stringify({ snippet: codeStr });
    const result = { content: [{ type: "text" as const, text: jsonText }] };

    const translator = createMockTranslator();
    await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("should skip target-language strings inside JSON values", async () => {
    // Long English string inside JSON exercises the isTargetLang branch.
    const englishText = "This is a long English sentence that should not be translated.";
    const jsonText = JSON.stringify({ body: englishText });
    const result = { content: [{ type: "text" as const, text: jsonText }] };

    const translator = createMockTranslator();
    await transformToolResult(
      result,
      createMockDetector(true),
      translator,
      "en",
    );

    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("should skip file paths (starting with /) inside JSON values", async () => {
    const longPath = "/usr/local/bin/some-long-command-name-here";
    const longJaText = "これは長い日本語のテキストで、翻訳されるべきです。";
    const jsonText = JSON.stringify({ path: longPath, desc: longJaText });
    const result = { content: [{ type: "text" as const, text: jsonText }] };

    const { content } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const transformed = content as typeof result;
    const parsed = JSON.parse(transformed.content[0].text);
    expect(parsed.path).toBe(longPath); // Path preserved verbatim
    expect(parsed.desc).toBe(`[EN] ${longJaText}`);
  });

  it("should skip relative paths (starting with .) inside JSON values", async () => {
    const relativePath = "./src/components/Header.tsx";
    const longJaText = "これは長い日本語のテキストで、翻訳されるべきです。";
    const jsonText = JSON.stringify({ file: relativePath, body: longJaText });
    const result = { content: [{ type: "text" as const, text: jsonText }] };

    const { content } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const transformed = content as typeof result;
    const parsed = JSON.parse(transformed.content[0].text);
    expect(parsed.file).toBe(relativePath);
    expect(parsed.body).toBe(`[EN] ${longJaText}`);
  });

  it("should skip home-relative paths (starting with ~) inside JSON values", async () => {
    const homePath = "~/Documents/project/README.md";
    const longJaText = "これは長い日本語のテキストで、翻訳されるべきです。";
    const jsonText = JSON.stringify({ location: homePath, info: longJaText });
    const result = { content: [{ type: "text" as const, text: jsonText }] };

    const { content } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const transformed = content as typeof result;
    const parsed = JSON.parse(transformed.content[0].text);
    expect(parsed.location).toBe(homePath);
  });

  it("should translate path-like strings that contain spaces", async () => {
    // Starts with '/' but contains spaces → not a structural path
    const notAPath = "/this is not really a path because it has spaces in it";
    const jsonText = JSON.stringify({ text: notAPath });
    const result = { content: [{ type: "text" as const, text: jsonText }] };

    const translator = createMockTranslator();
    await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    // Should be translated because it has spaces (not a file path)
    expect(translator.translate).toHaveBeenCalled();
  });

  it("should skip ISO date strings inside JSON values", async () => {
    const dateStr = "2024-03-15T10:30:00.000Z";
    const longJaText = "これは長い日本語のテキストで、翻訳されるべきです。";
    const jsonText = JSON.stringify({ createdAt: dateStr, summary: longJaText });
    const result = { content: [{ type: "text" as const, text: jsonText }] };

    const { content } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const transformed = content as typeof result;
    const parsed = JSON.parse(transformed.content[0].text);
    expect(parsed.createdAt).toBe(dateStr);
    expect(parsed.summary).toBe(`[EN] ${longJaText}`);
  });

  it("should translate strings starting with digits that are not ISO dates", async () => {
    // Starts with digit but doesn't match YYYY-MM-DD pattern
    const notDate = "42 is the answer to everything in the universe";
    const jsonText = JSON.stringify({ answer: notDate });
    const result = { content: [{ type: "text" as const, text: jsonText }] };

    const translator = createMockTranslator();
    await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    expect(translator.translate).toHaveBeenCalled();
  });

  it("should translate strings starting with h that are not URLs", async () => {
    // Starts with 'h' but not http(s)://
    const notUrl = "hello world, this is a long Japanese text about something";
    const jsonText = JSON.stringify({ greeting: notUrl });
    const result = { content: [{ type: "text" as const, text: jsonText }] };

    const translator = createMockTranslator();
    await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    expect(translator.translate).toHaveBeenCalled();
  });

  it("should pass through resource content blocks unchanged", async () => {
    const result = {
      content: [
        { type: "resource" as const, resource: { uri: "file:///test.txt", text: "content" } },
        { type: "text" as const, text: "翻訳テスト" },
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
      resource: { uri: "file:///test.txt", text: "content" },
    });
    expect(transformed.content[1].text).toBe("[EN] 翻訳テスト");
  });

  it("should treat all-whitespace text as a non-code-block (plain text path)", async () => {
    // All-whitespace string exercises the firstNonWsIndex fallthrough.
    // It's also (debatably) "target language", so should pass through as skipped.
    const wsText = "    \n\t   ";
    const result = { content: [{ type: "text" as const, text: wsText }] };

    const { content, stats } = await transformToolResult(
      result,
      createMockDetector(true), // pretend the detector says it's English
      createMockTranslator(),
      "en",
    );

    const transformed = content as typeof result;
    expect(transformed.content[0].text).toBe(wsText);
    expect(stats.blocksSkipped).toBe(1);
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

  it("should fall back to the raw lang code when not in LANG_NAMES", () => {
    const stats: TransformStats = {
      blocksTranslated: 1,
      blocksSkipped: 0,
      charsOriginal: 10,
      charsTransformed: 8,
      tokensOriginal: 5,
      tokensTransformed: 4,
      detectedLang: "xyz", // not a real ISO 639-3 code
    };

    const formatted = formatTransformStats(stats);
    expect(formatted).toContain("[xyz]");
  });

  it("should report 0% when tokensOriginal is zero but blocks were translated", () => {
    const stats: TransformStats = {
      blocksTranslated: 1,
      blocksSkipped: 0,
      charsOriginal: 0,
      charsTransformed: 0,
      tokensOriginal: 0,
      tokensTransformed: 0,
      detectedLang: "jpn",
    };

    const formatted = formatTransformStats(stats);
    expect(formatted).toContain("-0%");
  });
});
