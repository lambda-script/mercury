import { describe, it, expect, vi } from "vitest";
import type { Translator } from "../../src/translator/index.js";

// We test the translator interface contract with a mock,
// since the real Haiku translator requires an API key.
describe("Translator interface", () => {
  function createMockTranslator(): Translator {
    return {
      translate: vi.fn(async (text: string, _from: string, to: string) => {
        if (to === "en") {
          return `[translated to en] ${text}`;
        }
        return text;
      }),
    };
  }

  it("should translate text", async () => {
    const translator = createMockTranslator();
    const result = await translator.translate("こんにちは", "jpn", "en");
    expect(result).toBe("[translated to en] こんにちは");
  });

  it("should call translate with correct parameters", async () => {
    const translator = createMockTranslator();
    await translator.translate("テスト", "auto", "en");
    expect(translator.translate).toHaveBeenCalledWith("テスト", "auto", "en");
  });
});
