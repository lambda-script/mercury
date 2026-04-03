import translate from "google-translate-api-x";
import type { Translator } from "./index.js";
import { logger } from "../utils/logger.js";

export function createGoogleFreeTranslator(): Translator {
  return {
    async translate(text: string, from: string, to: string): Promise<string> {
      const fromLang = from === "auto" ? "auto" : from;

      logger.debug(`Translating ${text.length} chars from ${fromLang} to ${to}`);

      const result = await translate(text, { from: fromLang, to });

      logger.debug(`Translation complete: ${result.text.length} chars`);
      return result.text;
    },
  };
}
