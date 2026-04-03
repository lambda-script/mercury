export interface Translator {
  translate(text: string, from: string, to: string): Promise<string>;
}
