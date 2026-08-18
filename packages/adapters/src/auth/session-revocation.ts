import { eq } from "drizzle-orm";
import { domainError, err, ok, type Result } from "@rbrasier/domain";
import type { Database } from "../db/client";
import { core_sessions } from "../db/schema/core";

/**
 * Tracks, per user, which generation of cached principals is still valid.
 *
 * The session cache is keyed by cookie value, so a user's entries cannot be
 * found by id to delete them. Instead each cached entry records the epoch it was
 * resolved under; bumping a user's epoch strands every entry they hold at once,
 * with no reverse index to keep in step with TTL expiry or eviction
 * (ADR-035 §1).
 *
 * In-process, like the cache it guards. A multi-instance deployment falls back
 * to the cache TTL on the instances that did not serve the revoke.
 */
export interface SessionRevocationRegistry {
  epochFor(userId: string): number;
  revoke(userId: string): void;
}

export const createSessionRevocationRegistry = (): SessionRevocationRegistry => {
  // Only revoked users are held, so this grows with revocations, not with users.
  const epochs = new Map<string, number>();

  return {
    epochFor: (userId) => epochs.get(userId) ?? 0,
    revoke: (userId) => {
      epochs.set(userId, (epochs.get(userId) ?? 0) + 1);
    },
  };
};

/**
 * Ends every authentication session a user holds: deletes their `core_sessions`
 * rows, then bumps their cache epoch. Returns how many sessions were ended.
 *
 * The epoch is bumped even when nothing was deleted — a principal could have
 * been cached moments before the delete found the row already gone — but never
 * when the delete itself failed, because then the sessions are still live and
 * reporting otherwise would tell an admin a leaver was cut off when they were
 * not.
 */
export const revokeUserSessions = async (
  db: Database,
  registry: SessionRevocationRegistry,
  userId: string,
): Promise<Result<number>> => {
  try {
    const deleted = await db
      .delete(core_sessions)
      .where(eq(core_sessions.user_id, userId))
      .returning({ id: core_sessions.id });
    registry.revoke(userId);
    return ok(deleted.length);
  } catch (cause) {
    return err(domainError("INFRA_FAILURE", "Failed to revoke the user's sessions.", cause));
  }
};
