import type { NextResponse } from "next/server";
import { IMPERSONATION_COOKIE_NAME, type ResolvedSession } from "@wayfinder/adapters";
import type { ImpersonationTicket } from "@wayfinder/domain";

/**
 * Why these three operations are REST routes and not tRPC procedures.
 *
 * The app's tRPC client is `httpBatchStreamLink`, so `resolveResponse` builds
 * the response headers and returns `new Response(stream, { headers })` *before*
 * any procedure body runs (verified in @trpc/server@11.17.0,
 * resolveResponse §"application/jsonl"). Next appends `cookies().set()`
 * mutations to the returned response's headers in its app-route module, which by
 * then has already been handed back — so a cookie set inside a streamed
 * procedure is silently dropped. The procedure succeeds, the audit row is
 * written, and the browser never receives `Set-Cookie`.
 *
 * Setting the cookie on an explicit `NextResponse` here does not depend on that
 * plumbing at all.
 */

export const setImpersonationCookie = (
  response: NextResponse,
  value: string,
  ticket: ImpersonationTicket,
): void => {
  response.cookies.set({
    name: IMPERSONATION_COOKIE_NAME,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Convenience only — the server checks `expiresAt` inside the signed payload
    // and never relies on the browser to forget (ADR-059 §5).
    expires: ticket.expiresAt,
  });
};

export const clearImpersonationCookie = (response: NextResponse): void => {
  response.cookies.set({
    name: IMPERSONATION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
};

// While simulating, the admin is `impersonatorId`; otherwise they are the
// principal themselves. Both routes that end or extend a simulation need the
// admin, never the simulated user.
export const adminBehind = (principal: ResolvedSession): string =>
  principal.impersonatorId ?? principal.userId;
