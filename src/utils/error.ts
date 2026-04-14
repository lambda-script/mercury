/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * For Error instances the message (and optional `cause`) are included;
 * anything else is coerced to a string.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause ? ` (cause: ${err.cause})` : "";
    return `${err.message}${cause}`;
  }
  return String(err);
}
