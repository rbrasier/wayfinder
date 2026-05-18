import { NextResponse, type NextRequest } from "next/server";

const AUTH_METHOD = process.env.AUTH_METHOD ?? "magic-link";
const PKI_MODES = new Set(["pki", "pki-and-magic-link"]);

/**
 * Redirect unauthenticated requests for /admin/* to the appropriate auth
 * endpoint based on AUTH_METHOD. PKI modes redirect to /api/auth/cert so the
 * cert headers are consumed server-side; all other modes go to /admin/login.
 */
export const middleware = (req: NextRequest): NextResponse => {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith("/admin") || pathname.startsWith("/admin/login")) {
    return NextResponse.next();
  }

  const sessionCookie = req.cookies
    .getAll()
    .find((c) => c.name.endsWith(".session_token") || c.name === "better-auth.session_token");

  if (sessionCookie?.value) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();

  if (PKI_MODES.has(AUTH_METHOD)) {
    url.pathname = "/api/auth/cert";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  url.pathname = "/admin/login";
  return NextResponse.redirect(url);
};

export const config = {
  matcher: ["/admin/:path*"],
};
