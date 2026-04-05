import Anthropic from "@anthropic-ai/sdk";
import type { AuthMethod } from "../config.js";
import type { Translator } from "./index.js";
import { logger } from "../utils/logger.js";

/**
 * Create a Claude Haiku translator using the Anthropic SDK.
 *
 * Higher translation quality than google-free, but adds LLM API cost.
 * Connects directly to api.anthropic.com (bypasses any proxy to avoid loops).
 *
 * @param auth - Authentication method (API key or OAuth token)
 * @param model - Claude model ID (default: claude-haiku-4-5-20251001)
 * @returns A translator instance
 */
export function createHaikuTranslator(auth: AuthMethod, model: string): Translator {
  // Connect directly to api.anthropic.com to avoid infinite loop through proxy
  const client = new Anthropic({
    apiKey: auth.type === "api_key" ? auth.apiKey : null,
    authToken: auth.type === "auth_token" ? auth.authToken : null,
    baseURL: "https://api.anthropic.com",
    defaultHeaders:
      auth.type === "auth_token"
        ? { "anthropic-beta": "oauth-2025-04-20" }
        : undefined,
  });

  return {
    async translate(text: string, from: string, to: string): Promise<string> {
      const fromLabel = from === "auto" ? "the source language" : from;

      logger.debug(`Translating ${text.length} chars from ${fromLabel} to ${to}`);

      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: `Translate the following text from ${fromLabel} to ${to}. Output ONLY the translated text, nothing else. Do not add explanations, notes, or formatting.\n\n${text}`,
          },
        ],
      });

      const block = response.content[0];
      if (block.type !== "text") {
        throw new Error(`Unexpected response type: ${block.type}`);
      }

      logger.debug(`Translation complete: ${block.text.length} chars`);
      return block.text;
    },
  };
}
