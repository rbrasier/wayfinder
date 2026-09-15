import { IMPERSONATION_COOKIE_NAME } from "@wayfinder/adapters";

// Single source for reading the Better Auth session token out of a request's
// Cookie header. The tRPC context and every API route that authenticates from
// the raw request share this rather than re-implementing the same cookie split
// (the copies had drifted in whitespace/style). `Request` covers `NextRequest`
// too, so all callers pass their request straight through.
export const getSessionTokenFromRequest = (request: Request): string | null => {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  const pair = cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("better-auth.session_token="));
  return pair ? pair.slice("better-auth.session_token=".length) : null;
};

// The second cookie of the layered session (ADR-059). Read alongside the session
// token everywhere a principal is resolved, so no entry point can accidentally
// resolve the admin while the UI is showing someone else.
export const getImpersonationCookieFromRequest = (request: Request): string | null => {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  const pair = cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${IMPERSONATION_COOKIE_NAME}=`));
  return pair ? pair.slice(`${IMPERSONATION_COOKIE_NAME}=`.length) : null;
};
