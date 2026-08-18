import {
  TtlCache,
  createCachedSessionResolver,
  createSessionRevocationRegistry,
  resolveSession,
  revokeUserSessions,
  type CachedPrincipal,
  type Database,
} from "@rbrasier/adapters";
import type { AuthConfig, PermissionKey, Result } from "@rbrasier/domain";

interface SessionAuthDeps {
  db: Database;
  cacheTtlMs: number;
  cacheMaxEntries: number;
  // Read per resolution rather than captured, so a policy saved in the admin
  // card applies on the next request with no redeploy (ADR-035 §4).
  getAuthConfig: () => Promise<AuthConfig>;
}

/**
 * The auth hot path's caches and the one registry that invalidates them.
 *
 * Factored out of `container.ts` to keep that file under the source-size
 * ceiling, in the same way first-run bootstrap and flow portability already are.
 * These four pieces belong together: the session cache is only correct because
 * everything that ends a session — the admin action, the concurrency enforcer
 * and Entra precedence — bumps the same registry.
 */
export const buildSessionAuth = ({
  db,
  cacheTtlMs,
  cacheMaxEntries,
  getAuthConfig,
}: SessionAuthDeps) => {
  // Short-TTL caches in front of the two hottest auth lookups (session +
  // permission resolution). Single-instance correct; promote to a shared store
  // when running multiple instances. See the scaling-new-infrastructure phase doc.
  const sessionCache = new TtlCache<CachedPrincipal>({
    ttlMs: cacheTtlMs,
    maxEntries: cacheMaxEntries,
  });
  const permissionCache = new TtlCache<Set<PermissionKey>>({
    ttlMs: cacheTtlMs,
    maxEntries: cacheMaxEntries,
  });
  const sessionRevocations = createSessionRevocationRegistry();

  const resolveCachedSession = createCachedSessionResolver(
    db,
    sessionCache,
    sessionRevocations,
    async (database, cookieValue) => {
      const { sessionPolicy } = await getAuthConfig();
      return resolveSession(database, cookieValue, sessionPolicy);
    },
  );

  return {
    permissionCache,
    sessionRevocations,
    resolveCachedSession,
    revokeSessionsForUser: (userId: string): Promise<Result<number>> =>
      revokeUserSessions(db, sessionRevocations, userId),
  };
};
