/**
 * Find the index of the first non-whitespace character.
 * Returns text.length if the string is all whitespace.
 *
 * Avoids allocating a trimmed string copy just to check a prefix.
 */
export function firstNonWsIndex(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    // space, tab, newline, carriage return, form feed
    if (ch !== 0x20 && ch !== 0x09 && ch !== 0x0a && ch !== 0x0d && ch !== 0x0c) {
      return i;
    }
  }
  return text.length;
}
