import { config as dotenvConfig } from "dotenv";

dotenvConfig();

export type TranslationBackend = "google-free" | "haiku" | "deepl" | "google";

export type AuthMethod =
  | { readonly type: "api_key"; readonly apiKey: string }
  | { readonly type: "auth_token"; readonly authToken: string };

export interface Config {
  readonly backend: TranslationBackend;
  readonly sourceLang: string;
  readonly targetLang: string;
  readonly auth: AuthMethod | null;
  readonly proxyPort: number;
  readonly upstreamUrl: string;
  readonly minDetectLength: number;
}

export function loadConfig(): Config {
  const backend = (process.env.MERCURY_BACKEND as TranslationBackend) ?? "google-free";

  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN ?? "";

  let auth: AuthMethod | null = null;
  if (authToken) {
    auth = { type: "auth_token", authToken };
  } else if (apiKey) {
    auth = { type: "api_key", apiKey };
  }

  if (backend === "haiku" && !auth) {
    throw new Error(
      "ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is required when using the 'haiku' backend",
    );
  }

  return {
    backend,
    sourceLang: process.env.MERCURY_SOURCE_LANG ?? "auto",
    targetLang: process.env.MERCURY_TARGET_LANG ?? "en",
    auth,
    proxyPort: parseInt(process.env.MERCURY_PORT ?? "3100", 10),
    upstreamUrl: process.env.MERCURY_UPSTREAM_URL ?? "https://api.anthropic.com",
    minDetectLength: parseInt(process.env.MERCURY_MIN_DETECT_LENGTH ?? "20", 10),
  };
}
