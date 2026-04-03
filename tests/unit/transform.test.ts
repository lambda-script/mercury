import { describe, it, expect, vi } from "vitest";
import { transformRequest, type MessagesRequestBody } from "../../src/transform/messages.js";
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

describe("transformRequest", () => {
  it("should translate string content in messages", async () => {
    const body: MessagesRequestBody = {
      messages: [
        { role: "user", content: "こんにちは" },
      ],
      model: "claude-sonnet-4-20250514",
    };

    const result = await transformRequest(
      body,
      createMockDetector(false),
      createMockTranslator(),
      "eng",
    );

    expect(result.messages[0].content).toBe("[EN] こんにちは");
  });

  it("should translate text blocks in content array", async () => {
    const body: MessagesRequestBody = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "日本語テキスト" },
          ],
        },
      ],
      model: "claude-sonnet-4-20250514",
    };

    const result = await transformRequest(
      body,
      createMockDetector(false),
      createMockTranslator(),
      "eng",
    );

    const content = result.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    if (Array.isArray(content)) {
      expect(content[0]).toEqual({ type: "text", text: "[EN] 日本語テキスト" });
    }
  });

  it("should NOT translate tool_use.input", async () => {
    const body: MessagesRequestBody = {
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool_1",
              name: "read_file",
              input: { path: "/some/file.ts" },
            },
          ],
        },
      ],
      model: "claude-sonnet-4-20250514",
    };

    const translator = createMockTranslator();
    const result = await transformRequest(
      body,
      createMockDetector(false),
      translator,
      "eng",
    );

    const content = result.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    if (Array.isArray(content)) {
      expect(content[0]).toEqual({
        type: "tool_use",
        id: "tool_1",
        name: "read_file",
        input: { path: "/some/file.ts" },
      });
    }
    // Translator should not have been called for tool_use
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("should translate tool_result string content", async () => {
    const body: MessagesRequestBody = {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_1",
              content: "ファイルの内容です",
            },
          ],
        },
      ],
      model: "claude-sonnet-4-20250514",
    };

    const result = await transformRequest(
      body,
      createMockDetector(false),
      createMockTranslator(),
      "eng",
    );

    const content = result.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    if (Array.isArray(content)) {
      expect(content[0]).toMatchObject({
        type: "tool_result",
        tool_use_id: "tool_1",
        content: "[EN] ファイルの内容です",
      });
    }
  });

  it("should translate tool_result array content", async () => {
    const body: MessagesRequestBody = {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_1",
              content: [
                { type: "text", text: "結果テキスト" },
              ],
            },
          ],
        },
      ],
      model: "claude-sonnet-4-20250514",
    };

    const result = await transformRequest(
      body,
      createMockDetector(false),
      createMockTranslator(),
      "eng",
    );

    const content = result.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    if (Array.isArray(content)) {
      const toolResult = content[0] as { type: string; content: unknown[] };
      expect(toolResult.content[0]).toEqual({ type: "text", text: "[EN] 結果テキスト" });
    }
  });

  it("should skip translation for English text", async () => {
    const body: MessagesRequestBody = {
      messages: [
        { role: "user", content: "Hello world" },
      ],
      model: "claude-sonnet-4-20250514",
    };

    const translator = createMockTranslator();
    await transformRequest(
      body,
      createMockDetector(true), // isTargetLang returns true
      translator,
      "eng",
    );

    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("should preserve system prompt and append response language instruction", async () => {
    const body: MessagesRequestBody = {
      messages: [{ role: "user", content: "テスト" }],
      system: "You are a helpful assistant.",
      model: "claude-sonnet-4-20250514",
    };

    const result = await transformRequest(
      body,
      createMockDetector(false),
      createMockTranslator(),
      "eng",
    );

    expect(typeof result.system).toBe("string");
    expect(result.system).toContain("You are a helpful assistant.");
    expect(result.system).toContain("Japanese");
  });

  it("should inject response language into array system prompt", async () => {
    const body: MessagesRequestBody = {
      messages: [{ role: "user", content: "テスト" }],
      system: [{ type: "text", text: "You are a helpful assistant." }],
      model: "claude-sonnet-4-20250514",
    };

    const result = await transformRequest(
      body,
      createMockDetector(false),
      createMockTranslator(),
      "eng",
    );

    expect(Array.isArray(result.system)).toBe(true);
    if (Array.isArray(result.system)) {
      const texts = result.system.map((b) => (b as { text: string }).text).join(" ");
      expect(texts).toContain("You are a helpful assistant.");
      expect(texts).toContain("Japanese");
    }
  });

  it("should create system prompt with response language when no system prompt exists", async () => {
    const body: MessagesRequestBody = {
      messages: [{ role: "user", content: "テスト" }],
      model: "claude-sonnet-4-20250514",
    };

    const result = await transformRequest(
      body,
      createMockDetector(false),
      createMockTranslator(),
      "eng",
    );

    expect(typeof result.system).toBe("string");
    expect(result.system).toContain("Japanese");
  });

  it("should NOT inject response language when text is already in target language", async () => {
    const body: MessagesRequestBody = {
      messages: [{ role: "user", content: "Hello world" }],
      system: "You are a helpful assistant.",
      model: "claude-sonnet-4-20250514",
    };

    const result = await transformRequest(
      body,
      createMockDetector(true),
      createMockTranslator(),
      "eng",
    );

    expect(result.system).toBe("You are a helpful assistant.");
  });

  it("should preserve other body fields", async () => {
    const body: MessagesRequestBody = {
      messages: [{ role: "user", content: "テスト" }],
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      temperature: 0.7,
    };

    const result = await transformRequest(
      body,
      createMockDetector(false),
      createMockTranslator(),
      "eng",
    );

    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.max_tokens).toBe(1024);
    expect(result.temperature).toBe(0.7);
  });

  it("should handle multiple messages", async () => {
    const body: MessagesRequestBody = {
      messages: [
        { role: "user", content: "最初のメッセージ" },
        { role: "assistant", content: "Response" },
        { role: "user", content: "二番目のメッセージ" },
      ],
      model: "claude-sonnet-4-20250514",
    };

    const result = await transformRequest(
      body,
      createMockDetector(false),
      createMockTranslator(),
      "eng",
    );

    expect(result.messages).toHaveLength(3);
    expect(result.messages[0].content).toBe("[EN] 最初のメッセージ");
    expect(result.messages[1].content).toBe("[EN] Response");
    expect(result.messages[2].content).toBe("[EN] 二番目のメッセージ");
  });

  it("should handle image blocks by passing through", async () => {
    const imageBlock = {
      type: "image" as const,
      source: { type: "base64", media_type: "image/png", data: "..." },
    };
    const body: MessagesRequestBody = {
      messages: [
        {
          role: "user",
          content: [imageBlock, { type: "text", text: "画像について" }],
        },
      ],
      model: "claude-sonnet-4-20250514",
    };

    const result = await transformRequest(
      body,
      createMockDetector(false),
      createMockTranslator(),
      "eng",
    );

    const content = result.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    if (Array.isArray(content)) {
      expect(content[0]).toEqual(imageBlock);
      expect(content[1]).toEqual({ type: "text", text: "[EN] 画像について" });
    }
  });
});
