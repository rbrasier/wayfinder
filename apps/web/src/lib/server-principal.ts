import { cookies } from "next/headers";
import { IMPERSONATION_COOKIE_NAME, type ResolvedSession } from "@wayfinder/adapters";
import { getContainer } from "./container";

export interface ServerPrincipal {
  // Distinguishes "never signed in" from "session no longer resolves", which the
  // layouts send to different destinations.
  readonly hasSessionCookie: boolean;
  readonly principal: ResolvedSession | null;
}

/**
 * Resolves the principal for a server component or layout, reading both cookies
 * (ADR-059 §3b).
 *
 * Server components resolve independently of the tRPC context, so this exists to
 * stop the four call sites drifting: one of them reading only the session cookie
 * would render the admin's own view under a banner naming someone else.
 */
export const resolveServerPrincipal = async (): Promise<ServerPrincipal> => {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore
    .getAll()
    .find((c) => c.name.endsWith(".session_token") || c.name === "better-auth.session_token");

  if (!sessionCookie?.value) return { hasSessionCookie: false, principal: null };

  const principal = await getContainer().resolveSession(
    sessionCookie.value,
    cookieStore.get(IMPERSONATION_COOKIE_NAME)?.value ?? null,
  );
  return { hasSessionCookie: true, principal };
};
