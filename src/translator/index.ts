/** Translation backend that converts text between languages. */
export interface Translator {
  /**
   * Translate text from one language to another.
   *
   * @param text - Text to translate
   * @param from - Source language code, or "auto" for automatic detection
   * @param to - Target language code (e.g., "en")
   * @returns Translated text. On failure, implementations should return the original text (graceful degradation).
   */
  translate(text: string, from: string, to: string): Promise<string>;
}
