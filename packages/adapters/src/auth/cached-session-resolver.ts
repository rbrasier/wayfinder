import type { Database } from "../db/client";
import type { TtlCache } from "../cache/ttl-cache";
import type { SessionRevocationRegistry } from "./session-revocation";
import { resolveSession as resolveSessionFromDb, type ResolvedSession } from "./session-resolver";

type SessionLoader = (db: Database, cookieValue: string) => Promise<ResolvedSession | null>;

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
 */
export const createCachedSessionResolver = (
  db: Database,
  cache: TtlCache<CachedPrincipal>,
  registry: SessionRevocationRegistry,
  loader: SessionLoader = resolveSessionFromDb,
): ((cookieValue: string) => Promise<ResolvedSession | null>) => {
  return async (cookieValue) => {
    const cached = cache.get(cookieValue);
    if (cached && cached.epoch === registry.epochFor(cached.userId)) {
      return { userId: cached.userId, isAdmin: cached.isAdmin };
    }

    const resolved = await loader(db, cookieValue);
    if (resolved) cache.set(cookieValue, { ...resolved, epoch: registry.epochFor(resolved.userId) });
    return resolved;
  };
};
