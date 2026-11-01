import { cookies } from "next/headers";
import { IMPERSONATION_COOKIE_NAME } from "@wayfinder/adapters";
import { getContainer } from "@/lib/container";
import { getSessionTokenFromCookieStore } from "@/lib/session-token";
import { resolvePermissions, type TrpcContext } from "./trpc";

export const createServerTrpcContext = async (): Promise<TrpcContext> => {
  const cookieStore = await cookies();
  const token = getSessionTokenFromCookieStore(cookieStore);
  // Server components prefetch through this context, not through createTrpcContext.
  // Reading only the session cookie here would hydrate the admin's own data into
  // a page the client then re-renders as the simulated user (ADR-059 §3b).
  const impersonationCookie = cookieStore.get(IMPERSONATION_COOKIE_NAME)?.value ?? null;
  const container = getContainer();

  let userId: string | null = null;
  let authSessionId: string | null = null;
  let isAdmin = false;
  let impersonatorId: string | null = null;

  if (token) {
    const session = await container.resolveSession(token, impersonationCookie);
    if (session) {
      userId = session.userId;
      authSessionId = session.sessionId;
      isAdmin = session.isAdmin;
      impersonatorId = session.impersonatorId;
    }
  }

  const permissions = await resolvePermissions(container, userId, isAdmin);

  return {
    container,
    userId,
    authSessionId,
    isAdmin,
    impersonatorId,
    impersonationCookie,
    permissions,
    headers: new Headers(),
  };
};
