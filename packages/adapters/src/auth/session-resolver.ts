import { and, eq, gt } from "drizzle-orm";
import {
  DEFAULT_SESSION_POLICY,
  isSessionTimedOut,
  shouldRefreshLastActive,
  type SessionPolicy,
} from "@rbrasier/domain";
import type { Database } from "../db/client";
import { core_sessions, core_users } from "../db/schema/core";

export interface ResolvedSession {
  readonly userId: string;
  readonly isAdmin: boolean;
}

// Better Auth writes the session cookie as `<token>.<base64-signature>` (signed
// via HMAC). The DB only stores the bare token, so the signature suffix must be
// stripped before the lookup or every authenticated request 401s. Tokens are
// `[a-zA-Z0-9]{32}` so they never contain a `.` themselves (see
// @better-auth/core/utils/id.ts).
const stripCookieSignature = (cookieValue: string): string => {
  const dotIndex = cookieValue.indexOf(".");
  return dotIndex === -1 ? cookieValue : cookieValue.substring(0, dotIndex);
};

// Stamping is bookkeeping: a failed write must never cost a legitimate user
// their session, so it is swallowed rather than surfaced.
const stampLastActive = async (db: Database, sessionId: string, now: Date): Promise<void> => {
  try {
    await db
      .update(core_sessions)
      .set({ last_active_at: now })
      .where(eq(core_sessions.id, sessionId));
  } catch {
    // Deliberately ignored — see above.
  }
};

/**
 * Looks up a session token and returns the associated user info, or null if the
 * token is missing, expired, invalid, or rejected by the session policy. Never
 * throws — returns null on DB error.
 *
 * Timeouts are evaluated against fields already on the row, so policy costs no
 * extra query (ADR-035 §2). The last-active stamp is written at most once per
 * refresh interval, and is written whether or not an idle timeout is currently
 * set: if it only started when the policy was switched on, every live session
 * would read as idle since creation at that moment and everyone would be signed
 * out at once.
 */
export const resolveSession = async (
  db: Database,
  cookieValue: string,
  policy: SessionPolicy = DEFAULT_SESSION_POLICY,
  now: Date = new Date(),
): Promise<ResolvedSession | null> => {
  const token = stripCookieSignature(cookieValue);
  try {
    const [row] = await db
      .select({
        userId: core_sessions.user_id,
        isAdmin: core_users.is_admin,
        sessionId: core_sessions.id,
        createdAt: core_sessions.created_at,
        lastActiveAt: core_sessions.last_active_at,
      })
      .from(core_sessions)
      .innerJoin(core_users, eq(core_sessions.user_id, core_users.id))
      .where(and(eq(core_sessions.token, token), gt(core_sessions.expires_at, new Date())))
      .limit(1);
    if (!row) return null;

    if (isSessionTimedOut(policy, { createdAt: row.createdAt, lastActiveAt: row.lastActiveAt }, now)) {
      return null;
    }

    if (shouldRefreshLastActive(row.lastActiveAt, now)) {
      await stampLastActive(db, row.sessionId, now);
    }

    return { userId: row.userId, isAdmin: row.isAdmin };
  } catch {
    return null;
  }
};
