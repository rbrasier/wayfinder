import { NextResponse, type NextRequest } from "next/server";
import { createImpersonationTicket } from "@wayfinder/domain";
import { signImpersonationTicket } from "@wayfinder/adapters";
import { getContainer } from "@/lib/container";
import { setImpersonationCookie } from "@/lib/impersonation-actions";
import { withPrincipal } from "@/lib/with-principal";

interface StartBody {
  readonly userId?: unknown;
}

export const POST = (req: NextRequest): Promise<NextResponse> =>
  withPrincipal(req, async (principal) => {
    if (!principal.isAdmin || principal.impersonatorId) {
      // A simulated session is never an admin session, so an admin already
      // viewing as someone cannot start a nested simulation (ADR-059 §3).
      return NextResponse.json({ error: "Admin only." }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as StartBody;
    if (typeof body.userId !== "string" || body.userId.length === 0) {
      return NextResponse.json({ error: "A user to view as is required." }, { status: 400 });
    }

    const container = getContainer();
    const targetResult = await container.repos.users.findById(body.userId);
    if (targetResult.error) {
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
    if (!targetResult.data) {
      return NextResponse.json({ error: "That user no longer exists." }, { status: 404 });
    }

    const ticket = createImpersonationTicket({
      targetUserId: body.userId,
      impersonatorId: principal.userId,
    });
    if (ticket.error) {
      return NextResponse.json({ error: ticket.error.message }, { status: 400 });
    }

    // actor_id is the admin: starting a simulation is the admin's own action.
    // The explicit impersonatorId stops the ambient merge stamping
    // `impersonated: true` on a row whose actor already is the impersonator
    // (ADR-060 §5).
    await container.services.auditLogger.log({
      actorId: principal.userId,
      action: "impersonation.started",
      resourceType: "user",
      resourceId: body.userId,
      metadata: { impersonatorId: principal.userId, targetUserId: body.userId },
    });

    const response = NextResponse.json({
      targetUserId: body.userId,
      expiresAt: ticket.data.expiresAt.toISOString(),
    });
    setImpersonationCookie(
      response,
      signImpersonationTicket(ticket.data, container.env.BETTER_AUTH_SECRET),
      ticket.data,
    );
    return response;
  });
