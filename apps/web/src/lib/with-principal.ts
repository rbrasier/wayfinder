import { NextResponse } from "next/server";
import { runWithAuditActor, type ResolvedSession } from "@wayfinder/adapters";
import { getContainer } from "./container";
import { getImpersonationCookieFromRequest, getSessionTokenFromRequest } from "./session-token";

export type PrincipalHandler<T> = (principal: ResolvedSession) => Promise<T>;

/**
 * Resolves the request's principal and opens the audit actor scope as one
 * operation (ADR-060 §3a).
 *
 * The two are deliberately fused. Splitting them would let a route resolve
 * correctly and forget to open the scope, which loses the impersonator silently
 * — an audit row attributed to the simulated user with no sign an admin was
 * driving. Fused, a route that wants a principal gets the scope whether it
 * thought about it or not.
 *
 * Returns 401 when there is no principal, so no route repeats that check.
 */
export const withPrincipal = async <T>(
  request: Request,
  handler: PrincipalHandler<T>,
): Promise<T | NextResponse> => {
  const token = getSessionTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const principal = await getContainer().resolveSession(
    token,
    getImpersonationCookieFromRequest(request),
  );
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return runWithAuditActor(
    { userId: principal.userId, impersonatorId: principal.impersonatorId },
    () => handler(principal),
  );
};
