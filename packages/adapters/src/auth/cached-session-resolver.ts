import type { Database } from "../db/client";
import type { TtlCache } from "../cache/ttl-cache";
import type { SessionRevocationRegistry } from "./session-revocation";
import type { ResolvedSession } from "./session-resolver";

type SessionLoader = (
  db: Database,
  cookieValue: string,
  impersonationCookie: string | null,
) => Promise<ResolvedSession | null>;

// The impersonation cookie is part of the key, not just the value: the same
// admin browsing normally and browsing as someone else presents the same session
// token, so a key of the session cookie alone would serve one request's
// principal to the other (ADR-059). The NUL separator cannot occur in either
// cookie value, so no pair of cookies can collide on a key.
const cacheKeyFor = (cookieValue: string, impersonationCookie: string | null): string =>
  `${cookieValue}\u0000${impersonationCookie ?? ""}`;

// The epoch the principal was resolved under. An entry whose epoch is behind the
// user's current one belongs to a revoked generation and is ignored.
export type CachedPrincipal = ResolvedSession & { readonly epoch: number };

/**
 * Wraps {@link resolveSession} with a short-TTL cache so repeat requests on the same
 * session token skip the auth DB query — the second-hottest source of pool pressure
 * after the connection limit itself (see the scaling-current-stack phase doc).
 *
 * Only successful resolutions are cached. A missing/expired token is re-checked on
 * every request so a user who just logged in is never locked out by a negative cache
 * entry. The cookie value is the cache key; it already encodes the bare token.
 *
 * The registry is what makes admin revocation immediate: a bumped epoch strands
 * that user's cached entries without touching anyone else's (ADR-035 §1). It is
 * a required argument rather than a defaulted one, because a resolver holding a
 * registry nobody else can reach would silently never revoke.
 *
 * The epoch is checked against the *resolved* principal's user id, which during
 * a simulation is the target. Revoking the target therefore also strands the
 * cached simulation — the admin's next request re-resolves and, per ADR-059 §4,
 * keeps simulating; the session that matters is the admin's own.
 */
export const createCachedSessionResolver = (
  db: Database,
  cache: TtlCache<CachedPrincipal>,
  registry: SessionRevocationRegistry,
  // Required, not defaulted. A default that resolved only the session cookie
  // would silently ignore any simulation — the precise silent-miss this design
  // exists to prevent (ADR-059 §3b).
  loader: SessionLoader,
): ((
  cookieValue: string,
  impersonationCookie: string | null,
) => Promise<ResolvedSession | null>) => {
  return async (cookieValue, impersonationCookie) => {
    const key = cacheKeyFor(cookieValue, impersonationCookie);

    const cached = cache.get(key);
    if (cached && cached.epoch === registry.epochFor(cached.userId)) {
      // Named field by field rather than spread, so `epoch` stays internal to the
      // cache. Every field of ResolvedSession must appear here — one omitted is
      // one silently erased on every cache hit.
      return {
        userId: cached.userId,
        isAdmin: cached.isAdmin,
        impersonatorId: cached.impersonatorId,
      };
    }

    const resolved = await loader(db, cookieValue, impersonationCookie);
    if (resolved) cache.set(key, { ...resolved, epoch: registry.epochFor(resolved.userId) });
    return resolved;
  };
};
