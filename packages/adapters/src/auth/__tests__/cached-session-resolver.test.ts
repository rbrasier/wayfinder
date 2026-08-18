import { describe, expect, it, vi } from "vitest";
import {
  createCachedSessionResolver,
  type CachedPrincipal,
} from "../cached-session-resolver";
import { createSessionRevocationRegistry } from "../session-revocation";
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
  const cache = new TtlCache<CachedPrincipal>(options);
  const registry = createSessionRevocationRegistry();
  const resolve = createCachedSessionResolver({} as Database, cache, registry, loader);
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

describe("createCachedSessionResolver — revocation", () => {
  // The cache is keyed by cookie value, so a revoked user cannot be addressed by
  // id. Entries carry the epoch they were resolved under and a bump strands them
  // all at once (ADR-035 §1).
  const buildRevocableResolver = (rows: ResolvedSession | null) => {
    const loader = vi.fn(async (_db: Database, _cookieValue: string) => rows);
    const cache = new TtlCache<CachedPrincipal>({ ttlMs: 60_000, maxEntries: 10 });
    const registry = createSessionRevocationRegistry();
    const resolve = createCachedSessionResolver({} as Database, cache, registry, loader);
    return { loader, resolve, registry };
  };

  it("stops serving a cached principal once that user is revoked", async () => {
    const { loader, resolve, registry } = buildRevocableResolver({
      userId: "user-1",
      isAdmin: false,
    });
    await resolve("token-abc");

    registry.revoke("user-1");
    loader.mockResolvedValue(null);
    const afterRevoke = await resolve("token-abc");

    expect(afterRevoke).toBeNull();
    // The cached hit was skipped, so the deleted row was seen.
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("keeps serving other users from cache while one user is revoked", async () => {
    const { loader, resolve, registry } = buildRevocableResolver({
      userId: "user-2",
      isAdmin: false,
    });
    await resolve("token-other");

    registry.revoke("user-1");
    const other = await resolve("token-other");

    expect(other).toEqual({ userId: "user-2", isAdmin: false });
    expect(loader).toHaveBeenCalledOnce();
  });

  it("caches a fresh sign-in that happens after a revocation", async () => {
    const { loader, resolve, registry } = buildRevocableResolver({
      userId: "user-1",
      isAdmin: false,
    });
    registry.revoke("user-1");

    const first = await resolve("token-new");
    const second = await resolve("token-new");

    // Revocation ends the sessions that existed, not the user's ability to sign
    // back in and be cached again.
    expect(first).toEqual({ userId: "user-1", isAdmin: false });
    expect(second).toEqual({ userId: "user-1", isAdmin: false });
    expect(loader).toHaveBeenCalledOnce();
  });
});
