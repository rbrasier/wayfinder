import { isOk, ok, type PermissionKey, type Result } from "@rbrasier/domain";
import type { TtlCache } from "@rbrasier/adapters";

type PermissionLoader = (
  userId: string,
  isAdmin: boolean,
) => Promise<Result<Set<PermissionKey>>>;

/**
 * Wraps effective-permission resolution with a short-TTL cache so repeat authenticated
 * requests skip the role/permission DB round-trips on the hot path (see
 * the scaling-current-stack phase doc). Keyed by `userId:isAdmin` — admin status changes the granted set, so it is
 * part of the key rather than collapsed. Only successful results are cached; the short
 * TTL bounds how long a role/permission change stays stale.
 */
export const createCachedPermissionResolver = (
  loader: PermissionLoader,
  cache: TtlCache<Set<PermissionKey>>,
): PermissionLoader => {
  return async (userId, isAdmin) => {
    const key = `${userId}:${isAdmin}`;
    const cached = cache.get(key);
    if (cached) return ok(cached);

    const result = await loader(userId, isAdmin);
    if (isOk(result)) cache.set(key, result.data);
    return result;
  };
};
