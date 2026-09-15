import { eq } from "drizzle-orm";
import { isImpersonationExpired } from "@wayfinder/domain";
import type { Database } from "../db/client";
import { core_users } from "../db/schema/core";
import { verifyImpersonationTicket } from "./impersonation-cookie";
import type { ResolvedSession } from "./session-resolver";

/**
 * Layers a simulated view over an already-resolved session (ADR-059).
 *
 * The session cookie establishes who is really present; only then is the
 * impersonation cookie consulted. Every reason to refuse returns the admin's own
 * session rather than an error — a bad ticket must cost the admin their
 * simulation, never their session (ADR-059 §7). The one exception is having no
 * session at all, which returns null: a ticket alone is never authentication
 * (ADR-059 §1).
 */
export const resolveImpersonation = async (
  db: Database,
  selfSession: ResolvedSession | null,
  impersonationCookie: string | null,
  secret: string,
  now: Date = new Date(),
): Promise<ResolvedSession | null> => {
  if (!selfSession) return null;
  if (!impersonationCookie) return selfSession;

  const ticket = verifyImpersonationTicket(impersonationCookie, secret);
  if (!ticket) return selfSession;

  // A ticket is bound to the admin it was issued to, so one lifted into another
  // browser is inert (ADR-059 §2).
  if (ticket.impersonatorId !== selfSession.userId) return selfSession;
  if (isImpersonationExpired(ticket, now)) return selfSession;
  if (!selfSession.isAdmin) return selfSession;

  try {
    const [target] = await db
      .select({ isAdmin: core_users.is_admin })
      .from(core_users)
      .where(eq(core_users.id, ticket.targetUserId))
      .limit(1);
    if (!target) return selfSession;

    return {
      userId: ticket.targetUserId,
      isAdmin: target.isAdmin,
      impersonatorId: selfSession.userId,
    };
  } catch {
    // A database blip must not cost the admin their own session.
    return selfSession;
  }
};
