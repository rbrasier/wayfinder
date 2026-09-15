import { NextResponse, type NextRequest } from "next/server";
import { extendImpersonation } from "@wayfinder/domain";
import { signImpersonationTicket, verifyImpersonationTicket } from "@wayfinder/adapters";
import { getContainer } from "@/lib/container";
import { setImpersonationCookie } from "@/lib/impersonation-actions";
import { getImpersonationCookieFromRequest } from "@/lib/session-token";
import { withPrincipal } from "@/lib/with-principal";

export const POST = (req: NextRequest): Promise<NextResponse> =>
  withPrincipal(req, async (principal) => {
    if (!principal.impersonatorId) {
      return NextResponse.json(
        { error: "You are not viewing as another user." },
        { status: 412 },
      );
    }

    const container = getContainer();
    const secret = container.env.BETTER_AUTH_SECRET;
    const cookieValue = getImpersonationCookieFromRequest(req);
    const ticket = cookieValue ? verifyImpersonationTicket(cookieValue, secret) : null;
    if (!ticket) {
      return NextResponse.json({ error: "This session has ended." }, { status: 412 });
    }

    const extended = extendImpersonation(ticket);
    if (extended.error) {
      return NextResponse.json({ error: extended.error.message }, { status: 412 });
    }

    await container.services.auditLogger.log({
      actorId: principal.impersonatorId,
      action: "impersonation.extended",
      resourceType: "user",
      resourceId: principal.userId,
      metadata: {
        impersonatorId: principal.impersonatorId,
        targetUserId: principal.userId,
        expiresAt: extended.data.expiresAt.toISOString(),
      },
    });

    const response = NextResponse.json({
      expiresAt: extended.data.expiresAt.toISOString(),
    });
    setImpersonationCookie(
      response,
      signImpersonationTicket(extended.data, secret),
      extended.data,
    );
    return response;
  });
