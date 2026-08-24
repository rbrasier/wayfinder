import { and, eq, gt, inArray } from "drizzle-orm";
import { planSessionAdmission, type SessionPolicy } from "@rbrasier/domain";
import type { Database } from "../db/client";
import { core_sessions, core_users } from "../db/schema/core";
import type { SessionRevocationRegistry } from "./session-revocation";

export interface SessionAdmissionRequest {
  readonly userId: string;
  readonly policy: SessionPolicy;
  readonly now?: Date;
}

/**
 * Applies the concurrent-session limit to a session about to be created, and
 * returns whether it may proceed. Evicted sessions are deleted and the user's
 * cache epoch bumped, so an evicted device stops resolving immediately.
 *
 * The single enforcement point for every production sign-in: Better Auth's
 * session-create hook and the PKI adapter both call it, because there is no one
 * login path to hook (ADR-035 §3).
 *
 * Fails **open**. This runs inside the sign-in request, so a database blip that
 * made the limit unreadable would otherwise lock everybody out of the instance —
 * strictly worse than briefly allowing one session over the limit.
 */
export const enforceSessionConcurrency = async (
  db: Database,
  registry: SessionRevocationRegistry,
  { userId, policy, now = new Date() }: SessionAdmissionRequest,
): Promise<boolean> => {
  if (policy.concurrentSessionLimit <= 0) return true;

  try {
    const [user] = await db
      .select({ isAdmin: core_users.is_admin })
      .from(core_users)
      .where(eq(core_users.id, userId))
      .limit(1);

    const existingSessions = await db
      .select({ id: core_sessions.id, createdAt: core_sessions.created_at })
      .from(core_sessions)
      .where(and(eq(core_sessions.user_id, userId), gt(core_sessions.expires_at, now)));

    const plan = planSessionAdmission(policy, existingSessions, user?.isAdmin ?? false);
    if (!plan.admit) return false;
    if (plan.evictSessionIds.length === 0) return true;

    await db.delete(core_sessions).where(inArray(core_sessions.id, [...plan.evictSessionIds]));
    registry.revoke(userId);
    return true;
  } catch {
    return true;
  }
};
