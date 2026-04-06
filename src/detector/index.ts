/** Result of language detection on a text string. */
export interface DetectResult {
  /** ISO 639-3 language code (e.g., "eng", "jpn") or "und" if undetermined. */
  readonly lang: string;
  /** Detection confidence: 1 = detected, 0 = undetermined. */
  readonly confidence: number;
}

/** Language detector that identifies text language and checks target language match. */
export interface Detector {
  /** Detect the language of the given text. */
  detect(text: string): DetectResult;
  /** Returns true if the text is already in the target language (or undetermined). */
  isTargetLang(text: string, targetLang: string): boolean;
}
