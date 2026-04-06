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

  describe("capacity eviction", () => {
    it("should evict oldest entry when at MAX_PENDING (1000)", () => {
      const tracker = createRequestTracker();

      // Fill to capacity
      for (let i = 0; i < 1000; i++) {
        tracker.track(i, `method-${i}`);
      }
      expect(tracker.size).toBe(1000);

      // Adding one more should evict the oldest (id=0)
      tracker.track(1000, "tools/call");
      expect(tracker.size).toBe(1000);
      expect(tracker.take(0)).toBeUndefined(); // oldest was evicted
      expect(tracker.take(1000)).toBe("tools/call"); // newest is present
      expect(tracker.take(1)).toBe("method-1"); // second oldest still present
    });

    it("should evict entry with lowest timestamp when at capacity", () => {
      vi.useFakeTimers();
      const tracker = createRequestTracker();

      // Add entries at different times
      tracker.track("a", "method-a"); // ts = 0
      vi.advanceTimersByTime(100);
      tracker.track("b", "method-b"); // ts = 100
      vi.advanceTimersByTime(100);

      // Fill remaining capacity
      for (let i = 2; i < 1000; i++) {
        tracker.track(i, `method-${i}`);
      }

      // Add one more — should evict "a" (oldest timestamp)
      tracker.track("new", "tools/call");
      expect(tracker.take("a")).toBeUndefined();
      expect(tracker.take("b")).toBe("method-b");
      expect(tracker.take("new")).toBe("tools/call");

      vi.useRealTimers();
    });
  });
});
