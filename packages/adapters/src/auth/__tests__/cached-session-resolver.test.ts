import { describe, expect, it, vi } from "vitest";
import { createCachedSessionResolver } from "../cached-session-resolver";
import { TtlCache } from "../../cache/ttl-cache";
import type { ResolvedSession } from "../session-resolver";
import type { Database } from "../../db/client";

// The cached resolver delegates the actual DB lookup to a loader. We pass a spy so
// each test can assert exactly how many times the database would be hit.
const buildResolver = (
  rows: ResolvedSession | null,
  options = { ttlMs: 1000, maxEntries: 10 },
) => {
  const loader = vi.fn(async (_db: Database, _cookieValue: string) => rows);
  const cache = new TtlCache<ResolvedSession>(options);
  const resolve = createCachedSessionResolver({} as Database, cache, loader);
  return { loader, resolve };
};

describe("createCachedSessionResolver", () => {
  it("returns the resolved session and stores it for subsequent reads", async () => {
    const { loader, resolve } = buildResolver({ userId: "user-1", isAdmin: true });

    const first = await resolve("token-abc.signature");
    const second = await resolve("token-abc.signature");

    expect(first).toEqual({ userId: "user-1", isAdmin: true });
    expect(second).toEqual({ userId: "user-1", isAdmin: true });
    // The second call is served from cache, sparing a DB round-trip on the hot path.
    expect(loader).toHaveBeenCalledOnce();
  });

  it("does not cache an unresolved token so a fresh login is never blocked", async () => {
    const { loader, resolve } = buildResolver(null);

    const first = await resolve("missing-token");
    const second = await resolve("missing-token");

    expect(first).toBeNull();
    expect(second).toBeNull();
    // Negative results are re-checked every time; only successful sessions are cached.
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("re-queries the database when the cache is disabled with a zero TTL", async () => {
    const { loader, resolve } = buildResolver(
      { userId: "user-1", isAdmin: false },
      { ttlMs: 0, maxEntries: 10 },
    );

    await resolve("token-abc");
    await resolve("token-abc");

    expect(loader).toHaveBeenCalledTimes(2);
  });
});
