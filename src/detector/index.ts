export interface DetectResult {
  readonly lang: string;
  readonly confidence: number;
}

export interface Detector {
  detect(text: string): DetectResult;
  isTargetLang(text: string, targetLang: string): boolean;
}
