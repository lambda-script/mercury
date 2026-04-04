/**
 * Request/Response tracker for JSON-RPC 2.0 over stdio.
 * Maps request IDs to their method names so we can identify
 * which responses correspond to tools/call or tools/list requests.
 */

const MAX_PENDING = 1000;
const ENTRY_TTL_MS = 60_000; // 1 minute

interface TrackerEntry {
  readonly method: string;
  readonly ts: number;
}

export interface RequestTracker {
  /** Record a request ID and its method. */
  track(id: string | number, method: string): void;
  /** Retrieve and remove the method for a given response ID. Returns undefined if not tracked. */
  take(id: string | number): string | undefined;
  /** Number of currently tracked requests. */
  readonly size: number;
}

export function createRequestTracker(): RequestTracker {
  const pending = new Map<string | number, TrackerEntry>();

  function evictExpired(): void {
    const cutoff = Date.now() - ENTRY_TTL_MS;
    for (const [id, entry] of pending) {
      if (entry.ts < cutoff) pending.delete(id);
    }
  }

  return {
    track(id: string | number, method: string): void {
      evictExpired();
      // Drop oldest entry if at capacity
      if (pending.size >= MAX_PENDING) {
        const firstKey = pending.keys().next().value;
        if (firstKey !== undefined) pending.delete(firstKey);
      }
      pending.set(id, { method, ts: Date.now() });
    },

    take(id: string | number): string | undefined {
      const entry = pending.get(id);
      if (entry !== undefined) {
        pending.delete(id);
        return entry.method;
      }
      return undefined;
    },

    get size(): number {
      return pending.size;
    },
  };
}
