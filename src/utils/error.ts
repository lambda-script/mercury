/**
 * Extract a human-readable message from an unknown error value.
 *
 * Useful in catch blocks where the caught value is typed as `unknown`.
 */
export function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
