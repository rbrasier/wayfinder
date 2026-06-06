import { NextResponse, type NextRequest } from "next/server";

const AUTH_METHOD = process.env.AUTH_METHOD ?? "email-password";
const PKI_MODES = new Set(["pki", "pki-and-email-password"]);

const getSessionCookie = (req: NextRequest) =>
  req.cookies
    .getAll()
    .find((c) => c.name.endsWith(".session_token") || c.name === "better-auth.session_token");

const redirectToLogin = (req: NextRequest, pathname: string): NextResponse => {
  const url = req.nextUrl.clone();
  if (PKI_MODES.has(AUTH_METHOD)) {
    url.pathname = "/api/auth/cert";
    url.searchParams.set("redirect", pathname);
  } else {
    url.pathname = "/login";
  }
  return NextResponse.redirect(url);
};

export const middleware = (req: NextRequest): NextResponse => {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/admin") || pathname.startsWith("/chats") || pathname.startsWith("/flows")) {
    const sessionCookie = getSessionCookie(req);
    if (!sessionCookie?.value) {
      return redirectToLogin(req, pathname);
    }
  }

  return NextResponse.next();
};

export const config = {
  matcher: ["/login", "/register", "/admin/:path*", "/chats/:path*", "/chats", "/flows/:path*"],
};
