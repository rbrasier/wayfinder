import { and, eq, gt } from "drizzle-orm";
import type { Database } from "../db/client";
import { core_sessions, core_users } from "../db/schema/core";

export interface ResolvedSession {
  readonly userId: string;
  readonly isAdmin: boolean;
}

/**
 * Looks up a session token and returns the associated user info, or null if the
 * token is missing, expired, or invalid. Never throws — returns null on DB error.
 */
export const resolveSession = async (
  db: Database,
  token: string,
): Promise<ResolvedSession | null> => {
  try {
    const [row] = await db
      .select({ userId: core_sessions.user_id, isAdmin: core_users.is_admin })
      .from(core_sessions)
      .innerJoin(core_users, eq(core_sessions.user_id, core_users.id))
      .where(and(eq(core_sessions.token, token), gt(core_sessions.expires_at, new Date())))
      .limit(1);
    return row ?? null;
  } catch {
    return null;
  }
};
