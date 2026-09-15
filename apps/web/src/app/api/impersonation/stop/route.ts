import { NextResponse, type NextRequest } from "next/server";
import { verifyImpersonationTicket } from "@wayfinder/adapters";
import { getContainer } from "@/lib/container";
import { clearImpersonationCookie } from "@/lib/impersonation-actions";
import { getImpersonationCookieFromRequest } from "@/lib/session-token";
import { withPrincipal } from "@/lib/with-principal";

export const POST = (req: NextRequest): Promise<NextResponse> =>
  withPrincipal(req, async (principal) => {
    const response = NextResponse.json({ stopped: Boolean(principal.impersonatorId) });
    // Cleared unconditionally: a stale tab or an expired ticket should leave no
    // cookie behind, even though there is nothing to audit.
    clearImpersonationCookie(response);

    if (!principal.impersonatorId) return response;

    const container = getContainer();
    const cookieValue = getImpersonationCookieFromRequest(req);
    const ticket = cookieValue
      ? verifyImpersonationTicket(cookieValue, container.env.BETTER_AUTH_SECRET)
      : null;

    await container.services.auditLogger.log({
      actorId: principal.impersonatorId,
      action: "impersonation.stopped",
      resourceType: "user",
      resourceId: principal.userId,
      metadata: {
        impersonatorId: principal.impersonatorId,
        targetUserId: principal.userId,
        ...(ticket ? { durationMs: Date.now() - ticket.startedAt.getTime() } : {}),
      },
    });

    return response;
  });
