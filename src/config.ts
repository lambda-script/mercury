export type TranslationBackend = "haiku" | "deepl" | "google";

export interface Config {
  readonly backend: TranslationBackend;
  readonly sourceLang: string;
  readonly targetLang: string;
  readonly anthropicApiKey: string;
  readonly proxyPort: number;
  readonly upstreamUrl: string;
  readonly minDetectLength: number;
}

export function loadConfig(): Config {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (!anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required");
  }

  return {
    backend: (process.env.MERCURY_BACKEND as TranslationBackend) ?? "haiku",
    sourceLang: process.env.MERCURY_SOURCE_LANG ?? "auto",
    targetLang: process.env.MERCURY_TARGET_LANG ?? "en",
    anthropicApiKey,
    proxyPort: parseInt(process.env.MERCURY_PORT ?? "3100", 10),
    upstreamUrl: process.env.MERCURY_UPSTREAM_URL ?? "https://api.anthropic.com",
    minDetectLength: parseInt(process.env.MERCURY_MIN_DETECT_LENGTH ?? "20", 10),
  };
}
