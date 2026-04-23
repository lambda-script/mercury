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

  it("should skip long file paths inside JSON values", async () => {
    const longPath = "/usr/local/share/some-very-long-path/to/a/file.txt";
    const longJaText = "これは長い日本語のテキストで、翻訳されるべきです。";
    const jsonText = JSON.stringify({ path: longPath, body: longJaText });
    const result = { content: [{ type: "text" as const, text: jsonText }] };

    const { content } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const transformed = content as typeof result;
    const parsed = JSON.parse(transformed.content[0].text);
    expect(parsed.path).toBe(longPath);
    expect(parsed.body).toBe(`[EN] ${longJaText}`);
  });

  it("should skip relative file paths starting with dot", async () => {
    const relPath = "./src/components/very-long-component-name/index.ts";
    const longJaText = "これは長い日本語のテキストで、翻訳されるべきです。";
    const jsonText = JSON.stringify({ file: relPath, desc: longJaText });
    const result = { content: [{ type: "text" as const, text: jsonText }] };

    const { content } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const parsed = JSON.parse((content as typeof result).content[0].text);
    expect(parsed.file).toBe(relPath);
  });

  it("should skip home-relative paths starting with tilde", async () => {
    const homePath = "~/Documents/projects/very-long-project-name/config";
    const longJaText = "これは長い日本語のテキストで、翻訳されるべきです。";
    const jsonText = JSON.stringify({ loc: homePath, msg: longJaText });
    const result = { content: [{ type: "text" as const, text: jsonText }] };

    const { content } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const parsed = JSON.parse((content as typeof result).content[0].text);
    expect(parsed.loc).toBe(homePath);
  });

  it("should translate path-like strings that contain spaces", async () => {
    // Starts with "/" but has spaces → not a structural file path → translate
    const notAPath = "/this is actually a sentence that starts with a slash";
    const jsonText = JSON.stringify({ val: notAPath });
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

  it("should skip ISO dates inside JSON values", async () => {
    const isoDate = "2024-03-15T10:30:00.000Z is the timestamp";
    const longJaText = "これは長い日本語のテキストで、翻訳されるべきです。";
    const jsonText = JSON.stringify({ ts: isoDate, body: longJaText });
    const result = { content: [{ type: "text" as const, text: jsonText }] };

    const { content } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const parsed = JSON.parse((content as typeof result).content[0].text);
    expect(parsed.ts).toBe(isoDate);
    expect(parsed.body).toBe(`[EN] ${longJaText}`);
  });

  it("should translate strings starting with digits that are not ISO dates", async () => {
    // Starts with a digit but doesn't match YYYY-MM-DD → not structural
    const notDate = "42 is the answer to life, the universe, and everything, obviously";
    const jsonText = JSON.stringify({ val: notDate });
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

  it("should keep detectedLang null when detector returns confidence 0", async () => {
    const detector: Detector = {
      detect: vi.fn(() => ({ lang: "und", confidence: 0 })),
      isTargetLang: vi.fn(() => false),
    };

    const result = {
      content: [{ type: "text" as const, text: "Some ambiguous text here" }],
    };

    const { stats } = await transformToolResult(
      result,
      detector,
      createMockTranslator(),
      "en",
    );

    expect(stats.blocksTranslated).toBe(1);
    expect(stats.detectedLang).toBeNull();
  });

  it("should pass through resource content blocks unchanged", async () => {
    const resource = {
      uri: "file:///tmp/data.json",
      mimeType: "application/json",
      text: '{"key": "日本語のテキスト"}',
    };
    const result = {
      content: [
        { type: "resource" as const, resource },
        { type: "text" as const, text: "テスト文" },
      ],
    };

    const { content } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const transformed = content as typeof result;
    expect(transformed.content[0]).toEqual({ type: "resource", resource });
    expect(transformed.content[1].text).toBe("[EN] テスト文");
  });

  it("should set detectedLang only once across multiple text blocks", async () => {
    const detector: Detector = {
      detect: vi.fn()
        .mockReturnValueOnce({ lang: "jpn", confidence: 1 })
        .mockReturnValueOnce({ lang: "kor", confidence: 1 }),
      isTargetLang: vi.fn(() => false),
    };

    const result = {
      content: [
        { type: "text" as const, text: "最初のブロック" },
        { type: "text" as const, text: "두 번째 블록입니다" },
      ],
    };

    const { stats } = await transformToolResult(
      result,
      detector,
      createMockTranslator(),
      "en",
    );

    expect(stats.detectedLang).toBe("jpn");
    expect(stats.blocksTranslated).toBe(2);
  });

  it("should return original JSON array when no elements change", async () => {
    const jsonText = JSON.stringify(["short", "ids", 42, true, null]);
    const result = {
      content: [{ type: "text" as const, text: jsonText }],
    };

    const translator = createMockTranslator();
    const { content } = await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    const transformed = content as typeof result;
    expect(transformed.content[0].text).toBe(jsonText);
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("should handle mixed content with code block, text, and image blocks", async () => {
    const result = {
      content: [
        { type: "text" as const, text: "```js\nconsole.log('hi');\n```" },
        { type: "image" as const, data: "base64==", mimeType: "image/png" },
        { type: "text" as const, text: "翻訳すべきテキスト" },
      ],
    };

    const translator = createMockTranslator();
    const { content, stats } = await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    const transformed = content as typeof result;
    expect(transformed.content[0].text).toBe("```js\nconsole.log('hi');\n```");
    expect(transformed.content[1]).toEqual({ type: "image", data: "base64==", mimeType: "image/png" });
    expect(transformed.content[2].text).toBe("[EN] 翻訳すべきテキスト");
    expect(stats.blocksSkipped).toBe(1);
    expect(stats.blocksTranslated).toBe(1);
  });

  it("should handle JSON with nested objects containing translatable and structural strings", async () => {
    const longJa = "これは非常に長い日本語テキストで翻訳が必要です。十分な長さです。";
    const jsonText = JSON.stringify({
      metadata: {
        url: "https://example.com/api/v2/resource",
        path: "/usr/local/bin/very-long-executable-name",
        date: "2024-01-15T10:00:00Z long enough",
      },
      body: {
        title: longJa,
        nested: {
          description: longJa,
        },
      },
    });
    const result = { content: [{ type: "text" as const, text: jsonText }] };

    const { content, stats } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const parsed = JSON.parse((content as typeof result).content[0].text);
    expect(parsed.metadata.url).toBe("https://example.com/api/v2/resource");
    expect(parsed.metadata.path).toBe("/usr/local/bin/very-long-executable-name");
    expect(parsed.body.title).toBe(`[EN] ${longJa}`);
    expect(parsed.body.nested.description).toBe(`[EN] ${longJa}`);
    expect(stats.blocksTranslated).toBe(2);
  });

  it("should handle non-object non-null result (e.g. string or number)", async () => {
    const { content: c1, stats: s1 } = await transformToolResult(
      "plain string",
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );
    expect(c1).toBe("plain string");
    expect(s1.blocksTranslated).toBe(0);

    const { content: c2 } = await transformToolResult(
      42,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );
    expect(c2).toBe(42);
  });

  it("should translate JSON array where some elements change and some don't", async () => {
    const longJa = "これは長い日本語のテキストです。翻訳されるべきです。";
    const jsonText = JSON.stringify(["short", longJa, 42, longJa]);
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
    expect(parsed[0]).toBe("short");
    expect(parsed[1]).toBe(`[EN] ${longJa}`);
    expect(parsed[2]).toBe(42);
    expect(parsed[3]).toBe(`[EN] ${longJa}`);
    expect(stats.blocksTranslated).toBe(2);
  });

  it("should handle JSON with leading whitespace before opening brace", async () => {
    const longJa = "これは長い日本語のテキストです。翻訳されるべきです。";
    const jsonText = "   \n  " + JSON.stringify({ body: longJa });
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
    expect(parsed.body).toBe(`[EN] ${longJa}`);
    expect(stats.blocksTranslated).toBe(1);
  });

  it("should handle code block with leading whitespace", async () => {
    const codeText = "  \t```python\nprint('hello')\n```";
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

  it("should handle concurrent translation of multiple text blocks", async () => {
    const callOrder: number[] = [];
    let callIdx = 0;
    const translator: Translator = {
      translate: vi.fn(async (text: string) => {
        const idx = callIdx++;
        callOrder.push(idx);
        await new Promise((r) => setTimeout(r, 10));
        return `[${idx}] ${text}`;
      }),
    };

    const result = {
      content: [
        { type: "text" as const, text: "ブロック一" },
        { type: "text" as const, text: "ブロック二" },
        { type: "text" as const, text: "ブロック三" },
      ],
    };

    const { content, stats } = await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    const transformed = content as typeof result;
    expect(transformed.content).toHaveLength(3);
    expect(stats.blocksTranslated).toBe(3);
    // All three translations should have started (concurrent via Promise.all)
    expect(callOrder).toEqual([0, 1, 2]);
  });

  it("should handle JSON object where no values changed (identity optimization)", async () => {
    // Object with only structural/short strings — walker returns identical references
    const jsonText = JSON.stringify({
      url: "https://example.com/path",
      path: "/usr/bin/some-tool",
      id: "abc",
      count: 42,
    });
    const result = {
      content: [{ type: "text" as const, text: jsonText }],
    };

    const translator = createMockTranslator();
    const { content } = await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    const transformed = content as typeof result;
    // Original text preserved (no JSON.stringify re-serialization)
    expect(transformed.content[0].text).toBe(jsonText);
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("should handle text that starts with [ but is not valid JSON", async () => {
    const malformed = "[this is not json but starts with bracket and is long enough for translation";
    const result = {
      content: [{ type: "text" as const, text: malformed }],
    };

    const { content, stats } = await transformToolResult(
      result,
      createMockDetector(false),
      createMockTranslator(),
      "en",
    );

    const transformed = content as typeof result;
    expect(transformed.content[0].text).toBe(`[EN] ${malformed}`);
    expect(stats.blocksTranslated).toBe(1);
  });

  it("should handle deeply nested JSON arrays and objects mixed", async () => {
    const longJa = "これは長い日本語のテキストです。翻訳されるべきです。";
    const nested = {
      items: [
        { name: longJa, children: [{ desc: longJa }] },
        { name: "short", children: [] },
      ],
    };
    const jsonText = JSON.stringify(nested);
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
    expect(parsed.items[0].name).toBe(`[EN] ${longJa}`);
    expect(parsed.items[0].children[0].desc).toBe(`[EN] ${longJa}`);
    expect(parsed.items[1].name).toBe("short");
    expect(stats.blocksTranslated).toBe(2);
  });

  it("should handle text that is not a code block but starts similarly", async () => {
    // Triple backtick not at the start of content (after non-whitespace)
    const text = "Some text before ``` not really a code block at all";
    const result = {
      content: [{ type: "text" as const, text }],
    };

    const translator = createMockTranslator();
    const { stats } = await transformToolResult(
      result,
      createMockDetector(false),
      translator,
      "en",
    );

    expect(stats.blocksTranslated).toBe(1);
    expect(translator.translate).toHaveBeenCalled();
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
