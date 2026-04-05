// ISO 639-1 (config) → ISO 639-3 (franc) mapping
const ISO1_TO_ISO3: Readonly<Record<string, string>> = {
  en: "eng", ja: "jpn", ko: "kor", zh: "cmn",
  vi: "vie", th: "tha", ar: "ara", hi: "hin",
  bn: "ben", ru: "rus", uk: "ukr", de: "deu",
  fr: "fra", es: "spa", pt: "por", it: "ita",
  nl: "nld", pl: "pol", tr: "tur", id: "ind",
  ms: "msa",
};

/**
 * Convert ISO 639-1 language code to ISO 639-3 code (used by franc).
 *
 * @param lang - ISO 639-1 code (e.g., "en") or ISO 639-3 code (pass-through)
 * @returns ISO 639-3 code (e.g., "eng")
 */
export function toIso3(lang: string): string {
  return ISO1_TO_ISO3[lang] ?? lang;
}

// ISO 639-3 codes used by franc → human-readable language names
export const LANG_NAMES: Readonly<Record<string, string>> = {
  jpn: "Japanese",
  kor: "Korean",
  cmn: "Chinese",
  zho: "Chinese",
  vie: "Vietnamese",
  tha: "Thai",
  ara: "Arabic",
  hin: "Hindi",
  ben: "Bengali",
  rus: "Russian",
  ukr: "Ukrainian",
  deu: "German",
  fra: "French",
  spa: "Spanish",
  por: "Portuguese",
  ita: "Italian",
  nld: "Dutch",
  pol: "Polish",
  tur: "Turkish",
  ind: "Indonesian",
  msa: "Malay",
};
