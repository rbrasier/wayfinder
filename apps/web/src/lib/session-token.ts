// Better Auth prefixes the session cookie with __Secure- whenever BETTER_AUTH_URL
// is https (better-auth/dist/cookies/index.mjs). Behind a TLS-terminating load
// balancer that is the only cookie the browser holds, so reading the plain name
// alone leaves every request anonymous. The secure name is checked first, the
// same order Better Auth's own getCookie uses.
const SESSION_COOKIE_NAMES = ["__Secure-better-auth.session_token", "better-auth.session_token"] as const;

// Single source for reading the Better Auth session token out of a request's
// Cookie header. The tRPC context and every API route that authenticates from
// the raw request share this rather than re-implementing the same cookie split
// (the copies had drifted in whitespace/style). `Request` covers `NextRequest`
// too, so all callers pass their request straight through.
export const getSessionTokenFromRequest = (request: Request): string | null => {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  const entries = cookie.split(";").map((entry) => entry.trim());
  for (const name of SESSION_COOKIE_NAMES) {
    const pair = entries.find((entry) => entry.startsWith(`${name}=`));
    if (pair) return pair.slice(name.length + 1);
  }
  return null;
};

interface CookieLookup {
  get: (name: string) => { value?: string } | undefined;
}

// The same lookup for server components, which read `cookies()` rather than a
// raw Cookie header.
export const getSessionTokenFromCookieStore = (cookieStore: CookieLookup): string | null => {
  for (const name of SESSION_COOKIE_NAMES) {
    const value = cookieStore.get(name)?.value;
    if (value) return value;
  }
  return null;
};
