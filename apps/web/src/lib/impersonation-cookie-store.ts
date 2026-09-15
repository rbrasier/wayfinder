import { cookies } from "next/headers";
import { IMPERSONATION_COOKIE_NAME } from "@wayfinder/adapters";

// Wraps `next/headers` so the impersonation router can be tested through
// createCallerFactory without a live request. Verified against next@15.5.25:
// `ReadonlyRequestCookies` is `Omit<RequestCookies, 'set' | 'clear' | 'delete'>
// & Pick<ResponseCookies, 'set' | 'delete'>`, so set and delete are available
// inside a route handler — which is where tRPC runs.

export const readImpersonationCookie = async (): Promise<string | null> => {
  const store = await cookies();
  return store.get(IMPERSONATION_COOKIE_NAME)?.value ?? null;
};

export const writeImpersonationCookie = async (
  value: string,
  expiresAt: Date,
): Promise<void> => {
  const store = await cookies();
  store.set(IMPERSONATION_COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Convenience only — the server checks `expiresAt` inside the signed payload
    // and never relies on the browser to forget (ADR-059 §5).
    expires: expiresAt,
  });
};

export const clearImpersonationCookie = async (): Promise<void> => {
  const store = await cookies();
  store.delete(IMPERSONATION_COOKIE_NAME);
};
