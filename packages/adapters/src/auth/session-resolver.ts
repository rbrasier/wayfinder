import { and, eq, gt } from "drizzle-orm";
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

/**
 * Looks up a session token and returns the associated user info, or null if the
 * token is missing, expired, or invalid. Never throws — returns null on DB error.
 */
export const resolveSession = async (
  db: Database,
  cookieValue: string,
): Promise<ResolvedSession | null> => {
  const token = stripCookieSignature(cookieValue);
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
