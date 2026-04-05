export type TranslationBackend = "google-free" | "haiku";

export type AuthMethod =
  | { readonly type: "api_key"; readonly apiKey: string }
  | { readonly type: "auth_token"; readonly authToken: string };

export interface Config {
  readonly backend: TranslationBackend;
  readonly sourceLang: string;
  readonly targetLang: string;
  readonly auth: AuthMethod | null;
  readonly minDetectLength: number;
  readonly haikuModel: string;
}

/**
 * Load Mercury configuration from environment variables.
 *
 * @returns Configuration object with translation backend, auth, and language settings
 * @throws {Error} If haiku backend is selected but no ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is provided
 */
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
      "ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is required when using the 'haiku' backend. " +
      "Set one of these in the 'env' field of your .mcp.json configuration."
    );
  }

  return {
    backend,
    sourceLang: process.env.MERCURY_SOURCE_LANG ?? "auto",
    targetLang: process.env.MERCURY_TARGET_LANG ?? "en",
    auth,
    minDetectLength: parseInt(process.env.MERCURY_MIN_DETECT_LENGTH ?? "20", 10),
    haikuModel: process.env.MERCURY_HAIKU_MODEL ?? "claude-haiku-4-5-20251001",
  };
}
