import type { Database } from "../db/client";
import type { TtlCache } from "../cache/ttl-cache";
import { resolveSession as resolveSessionFromDb, type ResolvedSession } from "./session-resolver";

type SessionLoader = (db: Database, cookieValue: string) => Promise<ResolvedSession | null>;

/**
 * Wraps {@link resolveSession} with a short-TTL cache so repeat requests on the same
 * session token skip the auth DB query — the second-hottest source of pool pressure
 * after the connection limit itself (see docs/guides/scaling-current-stack.md).
 *
 * Only successful resolutions are cached. A missing/expired token is re-checked on
 * every request so a user who just logged in is never locked out by a negative cache
 * entry. The cookie value is the cache key; it already encodes the bare token.
 */
export const createCachedSessionResolver = (
  db: Database,
  cache: TtlCache<ResolvedSession>,
  loader: SessionLoader = resolveSessionFromDb,
): ((cookieValue: string) => Promise<ResolvedSession | null>) => {
  return async (cookieValue) => {
    const cached = cache.get(cookieValue);
    if (cached) return cached;

    const resolved = await loader(db, cookieValue);
    if (resolved) cache.set(cookieValue, resolved);
    return resolved;
  };
};
