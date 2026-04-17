/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * Errors caught with `catch (err)` are typed `unknown`, so every log site
 * has to narrow before reading `.message`. This helper centralizes that
 * narrowing so the call sites stay readable.
 */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
