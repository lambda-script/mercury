/** Available translation backend identifiers. */
export type TranslationBackend = "google-free" | "haiku";

/** Authentication method for the haiku backend: API key or OAuth token. */
export type AuthMethod =
  | { readonly type: "api_key"; readonly apiKey: string }
  | { readonly type: "auth_token"; readonly authToken: string };

/** Mercury configuration loaded from MERCURY_* environment variables. */
export interface Config {
  /** Translation backend to use. */
  readonly backend: TranslationBackend;
  /** Source language code, or "auto" for automatic detection. */
  readonly sourceLang: string;
  /** Target language code for translation output (e.g., "en"). */
  readonly targetLang: string;
  /** Authentication for the haiku backend. Null when using google-free. */
  readonly auth: AuthMethod | null;
  /** Minimum text length (chars) for franc-based language detection. Shorter text uses Unicode script detection. */
  readonly minDetectLength: number;
  /** Claude model ID for the haiku backend. */
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
      "Set one of these in the 'env' field of your .mcp.json configuration — " +
      "Claude Code does NOT automatically forward ANTHROPIC_* variables to MCP server processes."
    );
  }

  const minDetectLengthRaw = process.env.MERCURY_MIN_DETECT_LENGTH ?? "20";
  const minDetectLength = parseInt(minDetectLengthRaw, 10);
  if (!Number.isInteger(minDetectLength) || minDetectLength < 1) {
    throw new Error(
      `MERCURY_MIN_DETECT_LENGTH must be a positive integer, got '${minDetectLengthRaw}'. ` +
      `Example: MERCURY_MIN_DETECT_LENGTH=20`
    );
  }

  return {
    backend,
    sourceLang: process.env.MERCURY_SOURCE_LANG ?? "auto",
    targetLang: process.env.MERCURY_TARGET_LANG ?? "en",
    auth,
    minDetectLength,
    haikuModel: process.env.MERCURY_HAIKU_MODEL ?? "claude-haiku-4-5-20251001",
  };
}
