import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequestTracker } from "../../src/proxy/tracker.js";

describe("RequestTracker", () => {
  it("should track and retrieve a request method by ID", () => {
    const tracker = createRequestTracker();
    tracker.track(1, "tools/call");

    expect(tracker.take(1)).toBe("tools/call");
  });

  it("should remove entry after take", () => {
    const tracker = createRequestTracker();
    tracker.track(1, "tools/call");

    tracker.take(1);
    expect(tracker.take(1)).toBeUndefined();
  });

  it("should return undefined for untracked IDs", () => {
    const tracker = createRequestTracker();
    expect(tracker.take(999)).toBeUndefined();
  });

  it("should handle string IDs", () => {
    const tracker = createRequestTracker();
    tracker.track("req-1", "tools/list");

    expect(tracker.take("req-1")).toBe("tools/list");
  });

  it("should track multiple requests independently", () => {
    const tracker = createRequestTracker();
    tracker.track(1, "tools/call");
    tracker.track(2, "tools/list");
    tracker.track(3, "tools/call");

    expect(tracker.take(2)).toBe("tools/list");
    expect(tracker.take(1)).toBe("tools/call");
    expect(tracker.take(3)).toBe("tools/call");
  });

  it("should report correct size", () => {
    const tracker = createRequestTracker();
    expect(tracker.size).toBe(0);

    tracker.track(1, "tools/call");
    tracker.track(2, "tools/list");
    expect(tracker.size).toBe(2);

    tracker.take(1);
    expect(tracker.size).toBe(1);
  });

  it("should overwrite method if same ID is tracked twice", () => {
    const tracker = createRequestTracker();
    tracker.track(1, "tools/call");
    tracker.track(1, "tools/list");

    expect(tracker.take(1)).toBe("tools/list");
  });

  describe("capacity eviction", () => {
    it("should evict oldest entry when at max capacity (1000)", () => {
      const tracker = createRequestTracker();

      // Fill to capacity
      for (let i = 0; i < 1000; i++) {
        tracker.track(i, "tools/call");
      }
      expect(tracker.size).toBe(1000);

      // Adding one more should evict the oldest (id=0)
      tracker.track(1000, "tools/call");
      expect(tracker.size).toBe(1000);
      expect(tracker.take(0)).toBeUndefined();
      expect(tracker.take(1000)).toBe("tools/call");
      // id=1 should still be there (second oldest, not evicted)
      expect(tracker.take(1)).toBe("tools/call");
    });

    it("should evict expired entries before checking capacity", () => {
      vi.useFakeTimers();
      const tracker = createRequestTracker();

      // Add entries that will expire
      for (let i = 0; i < 500; i++) {
        tracker.track(i, "tools/call");
      }

      // Advance past TTL
      vi.advanceTimersByTime(61_000);

      // Add more entries (expired ones should be cleaned first)
      for (let i = 500; i < 1000; i++) {
        tracker.track(i, "tools/call");
      }

      // Expired entries should be gone
      expect(tracker.take(0)).toBeUndefined();
      // Recent entries should still be there
      expect(tracker.take(999)).toBe("tools/call");
      vi.useRealTimers();
    });
  });

  describe("TTL eviction", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should evict expired entries on track()", () => {
      const tracker = createRequestTracker();
      tracker.track(1, "tools/call");

      // Advance past TTL (60s)
      vi.advanceTimersByTime(61_000);

      // Tracking a new entry triggers eviction
      tracker.track(2, "tools/list");

      expect(tracker.take(1)).toBeUndefined();
      expect(tracker.take(2)).toBe("tools/list");
    });

    it("should not evict entries within TTL", () => {
      const tracker = createRequestTracker();
      tracker.track(1, "tools/call");

      vi.advanceTimersByTime(30_000);
      tracker.track(2, "tools/list");

      expect(tracker.take(1)).toBe("tools/call");
    });
  });
});
