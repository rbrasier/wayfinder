import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TtlCache } from "../ttl-cache";

describe("TtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a value that was set within its TTL", () => {
    const cache = new TtlCache<string>({ ttlMs: 1000, maxEntries: 10 });

    cache.set("user-1", "value");

    expect(cache.get("user-1")).toBe("value");
  });

  it("returns undefined for a key that was never set", () => {
    const cache = new TtlCache<string>({ ttlMs: 1000, maxEntries: 10 });

    expect(cache.get("missing")).toBeUndefined();
  });

  it("expires an entry once its TTL has elapsed", () => {
    const cache = new TtlCache<string>({ ttlMs: 1000, maxEntries: 10 });
    cache.set("user-1", "value");

    vi.advanceTimersByTime(1001);

    expect(cache.get("user-1")).toBeUndefined();
  });

  it("treats a zero TTL as disabled so every read misses", () => {
    const cache = new TtlCache<string>({ ttlMs: 0, maxEntries: 10 });

    cache.set("user-1", "value");

    expect(cache.get("user-1")).toBeUndefined();
  });

  it("evicts the oldest entry when it exceeds the max size", () => {
    const cache = new TtlCache<string>({ ttlMs: 1000, maxEntries: 2 });

    cache.set("first", "1");
    cache.set("second", "2");
    cache.set("third", "3");

    expect(cache.get("first")).toBeUndefined();
    expect(cache.get("second")).toBe("2");
    expect(cache.get("third")).toBe("3");
  });

  it("refreshes recency on write so a re-set key survives eviction", () => {
    const cache = new TtlCache<string>({ ttlMs: 1000, maxEntries: 2 });

    cache.set("first", "1");
    cache.set("second", "2");
    cache.set("first", "1-again");
    cache.set("third", "3");

    expect(cache.get("first")).toBe("1-again");
    expect(cache.get("second")).toBeUndefined();
    expect(cache.get("third")).toBe("3");
  });

  it("forgets a key on delete so invalidation is immediate", () => {
    const cache = new TtlCache<string>({ ttlMs: 1000, maxEntries: 10 });
    cache.set("user-1", "value");

    cache.delete("user-1");

    expect(cache.get("user-1")).toBeUndefined();
  });

  it("drops every entry on clear", () => {
    const cache = new TtlCache<string>({ ttlMs: 1000, maxEntries: 10 });
    cache.set("user-1", "a");
    cache.set("user-2", "b");

    cache.clear();

    expect(cache.get("user-1")).toBeUndefined();
    expect(cache.get("user-2")).toBeUndefined();
  });
});
