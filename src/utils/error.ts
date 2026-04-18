/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * For `Error` instances the `.cause` property (if present) is appended so
 * that wrapped/chained errors surface useful context in log lines.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause ? ` (cause: ${err.cause})` : "";
    return `${err.message}${cause}`;
  }
  return String(err);
}
