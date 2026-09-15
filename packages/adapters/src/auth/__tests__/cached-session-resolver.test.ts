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
  const loader = vi.fn(
    async (_db: Database, _cookieValue: string, _impersonationCookie: string | null) => rows,
  );
  const cache = new TtlCache<CachedPrincipal>(options);
  const registry = createSessionRevocationRegistry();
  const resolve = createCachedSessionResolver({} as Database, cache, registry, loader);
  return { loader, resolve };
};

describe("createCachedSessionResolver", () => {
  it("returns the resolved session and stores it for subsequent reads", async () => {
    const { loader, resolve } = buildResolver({ userId: "user-1", isAdmin: true, impersonatorId: null });

    const first = await resolve("token-abc.signature", null);
    const second = await resolve("token-abc.signature", null);

    expect(first).toEqual({ userId: "user-1", isAdmin: true, impersonatorId: null });
    expect(second).toEqual({ userId: "user-1", isAdmin: true, impersonatorId: null });
    // The second call is served from cache, sparing a DB round-trip on the hot path.
    expect(loader).toHaveBeenCalledOnce();
  });

  it("does not cache an unresolved token so a fresh login is never blocked", async () => {
    const { loader, resolve } = buildResolver(null);

    const first = await resolve("missing-token", null);
    const second = await resolve("missing-token", null);

    expect(first).toBeNull();
    expect(second).toBeNull();
    // Negative results are re-checked every time; only successful sessions are cached.
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("re-queries the database when the cache is disabled with a zero TTL", async () => {
    const { loader, resolve } = buildResolver(
      { userId: "user-1", isAdmin: false, impersonatorId: null },
      { ttlMs: 0, maxEntries: 10 },
    );

    await resolve("token-abc", null);
    await resolve("token-abc", null);

    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe("createCachedSessionResolver — revocation", () => {
  // The cache is keyed by cookie value, so a revoked user cannot be addressed by
  // id. Entries carry the epoch they were resolved under and a bump strands them
  // all at once (ADR-035 §1).
  const buildRevocableResolver = (rows: ResolvedSession | null) => {
    const loader = vi.fn(
    async (_db: Database, _cookieValue: string, _impersonationCookie: string | null) => rows,
  );
    const cache = new TtlCache<CachedPrincipal>({ ttlMs: 60_000, maxEntries: 10 });
    const registry = createSessionRevocationRegistry();
    const resolve = createCachedSessionResolver({} as Database, cache, registry, loader);
    return { loader, resolve, registry };
  };

  it("stops serving a cached principal once that user is revoked", async () => {
    const { loader, resolve, registry } = buildRevocableResolver({
      userId: "user-1",
      isAdmin: false,
      impersonatorId: null,
    });
    await resolve("token-abc", null);

    registry.revoke("user-1");
    loader.mockResolvedValue(null);
    const afterRevoke = await resolve("token-abc", null);

    expect(afterRevoke).toBeNull();
    // The cached hit was skipped, so the deleted row was seen.
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("keeps serving other users from cache while one user is revoked", async () => {
    const { loader, resolve, registry } = buildRevocableResolver({
      userId: "user-2",
      isAdmin: false,
      impersonatorId: null,
    });
    await resolve("token-other", null);

    registry.revoke("user-1");
    const other = await resolve("token-other", null);

    expect(other).toEqual({ userId: "user-2", isAdmin: false, impersonatorId: null });
    expect(loader).toHaveBeenCalledOnce();
  });

  it("caches a fresh sign-in that happens after a revocation", async () => {
    const { loader, resolve, registry } = buildRevocableResolver({
      userId: "user-1",
      isAdmin: false,
      impersonatorId: null,
    });
    registry.revoke("user-1");

    const first = await resolve("token-new", null);
    const second = await resolve("token-new", null);

    // Revocation ends the sessions that existed, not the user's ability to sign
    // back in and be cached again.
    expect(first).toEqual({ userId: "user-1", isAdmin: false, impersonatorId: null });
    expect(second).toEqual({ userId: "user-1", isAdmin: false, impersonatorId: null });
    expect(loader).toHaveBeenCalledOnce();
  });
});

describe("createCachedSessionResolver — impersonation", () => {
  const ADMIN = "admin-1";
  const TARGET = "target-1";

  // The loader answers according to whether an impersonation cookie was passed,
  // which is what lets these tests prove the key distinguishes the two.
  const buildImpersonatingResolver = () => {
    const loader = vi.fn(
      async (_db: Database, _cookieValue: string, impersonationCookie: string | null) =>
        impersonationCookie
          ? { userId: TARGET, isAdmin: false, impersonatorId: ADMIN }
          : { userId: ADMIN, isAdmin: true, impersonatorId: null },
    );
    const cache = new TtlCache<CachedPrincipal>({ ttlMs: 60_000, maxEntries: 10 });
    const registry = createSessionRevocationRegistry();
    const resolve = createCachedSessionResolver({} as Database, cache, registry, loader);
    return { loader, resolve };
  };

  it("keeps impersonatorId on a cache hit — the hit path must not drop it", async () => {
    const { loader, resolve } = buildImpersonatingResolver();

    const first = await resolve("token-abc", "ticket-xyz");
    const second = await resolve("token-abc", "ticket-xyz");

    expect(first).toEqual({ userId: TARGET, isAdmin: false, impersonatorId: ADMIN });
    expect(second).toEqual({ userId: TARGET, isAdmin: false, impersonatorId: ADMIN });
    expect(loader).toHaveBeenCalledOnce();
  });

  it("does not serve a simulated principal to a non-simulated request on the same token", async () => {
    const { resolve } = buildImpersonatingResolver();

    await resolve("token-abc", "ticket-xyz");
    const asThemselves = await resolve("token-abc", null);

    expect(asThemselves).toEqual({ userId: ADMIN, isAdmin: true, impersonatorId: null });
  });

  it("does not serve a non-simulated principal to a simulated request on the same token", async () => {
    const { resolve } = buildImpersonatingResolver();

    await resolve("token-abc", null);
    const simulating = await resolve("token-abc", "ticket-xyz");

    expect(simulating).toEqual({ userId: TARGET, isAdmin: false, impersonatorId: ADMIN });
  });

  it("gives two different tickets on one token their own cache entries", async () => {
    const { loader, resolve } = buildImpersonatingResolver();

    await resolve("token-abc", "ticket-one");
    await resolve("token-abc", "ticket-two");

    expect(loader).toHaveBeenCalledTimes(2);
  });
});
