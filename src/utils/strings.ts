/**
 * Return the index of the first non-whitespace character in `text`.
 * Returns `text.length` when the string is empty or whitespace-only.
 */
export function firstNonWsIndex(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch !== 0x20 && ch !== 0x09 && ch !== 0x0a && ch !== 0x0d && ch !== 0x0c) {
      return i;
    }
  }
  return text.length;
}
