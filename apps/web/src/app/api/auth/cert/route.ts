import { NextResponse } from "next/server";
import { isPkiUsable } from "@wayfinder/domain";
import { CERT_SIGN_IN_ERROR_PARAM, type CertSignInError } from "@/lib/cert-sign-in-errors";
import { getContainer } from "@/lib/container";

const SAFE_REDIRECT_RE = /^\/(?!\/)/;

function safeRedirectPath(raw: string | null): string {
  if (!raw || !SAFE_REDIRECT_RE.test(raw)) return "/";
  try {
    const url = new URL(raw, "http://localhost");
    return url.pathname + url.search;
  } catch {
    return "/";
  }
}

// A misconfigured deployment is the server's fault, not the caller's, so it must
// not be reported as a 400 alongside a malformed certificate header.
function statusFor(code: string): number {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "INFRA_FAILURE") return 500;
  return 400;
}

/**
 * Which failure to tell the visitor about, as a code rather than the server's
 * own message — the login page owns the wording, and nothing the server says
 * gets reflected into the page.
 *
 * The `no_certificate` case is the one an operator hits first: a browser
 * pointed straight at the app, with no mTLS proxy in front, carries no
 * `x-ssl-client-*` headers at all. The adapter can only report that as "not
 * from a trusted proxy", which reads like a misconfigured IP list when the real
 * answer is that this URL is not meant to be opened directly.
 */
function errorCodeFor(request: Request, domainErrorCode: string): CertSignInError {
  if (!request.headers.get("x-ssl-client-verified")) return "no_certificate";
  if (domainErrorCode === "UNAUTHORIZED") return "rejected";
  if (domainErrorCode === "INFRA_FAILURE") return "misconfigured";
  return "no_identity";
}

function extractSourceIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const last = forwarded.split(",").at(-1)?.trim();
    if (last) return last;
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

function failureResponse(
  request: Request,
  options: { isBrowserNavigation: boolean; code: CertSignInError; message: string; status: number },
): NextResponse {
  // A programmatic caller — the mock proxy, or anything driving the exchange
  // directly — wants the status and the reason. A person who just clicked
  // "Sign in with your certificate" wants a page.
  if (!options.isBrowserNavigation) {
    return NextResponse.json({ error: options.message }, { status: options.status });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set(CERT_SIGN_IN_ERROR_PARAM, options.code);
  return NextResponse.redirect(loginUrl, 302);
}

async function signInWithCertificate(
  request: Request,
  isBrowserNavigation: boolean,
): Promise<NextResponse> {
  const container = getContainer();

  // Not usable, not merely disabled: an enabled PKI whose PKI_TRUSTED_PROXY_IPS
  // went missing in a later deploy is just as unable to authenticate anyone, and
  // answering 403 here keeps it from reaching the adapter for a vaguer error
  // (ADR-042 §1). The adapter is always constructed now, so its presence says
  // nothing about whether certificate sign-in is on.
  const authConfig = await container.runtimeConfig.getAuthConfig();
  if (!isPkiUsable(authConfig, container.runtimeConfig.isPkiEnvConfigured())) {
    return failureResponse(request, {
      isBrowserNavigation,
      code: "disabled",
      message: "Certificate sign-in is not enabled.",
      status: 403,
    });
  }

  const { searchParams } = new URL(request.url);
  const redirectTo = safeRedirectPath(searchParams.get("redirect"));
  const sourceIp = extractSourceIp(request);

  const result = await container.pkiCertAdapter.authenticate(request.headers, sourceIp);

  if (result.error) {
    return failureResponse(request, {
      isBrowserNavigation,
      code: errorCodeFor(request, result.error.code),
      message: result.error.message,
      status: statusFor(result.error.code),
    });
  }

  const response = NextResponse.redirect(new URL(redirectTo, request.url), 302);
  const secure = new URL(request.url).protocol === "https:";
  response.cookies.set("better-auth.session_token", result.data.token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
  });

  return response;
}

// GET is the method that matters in production: middleware answers an
// unauthenticated page request with /login, and the certificate control there is
// a plain navigation to this route. The mTLS proxy attaches the x-ssl-client-*
// headers to that request exactly as it does to any other, so there is nothing
// for a POST to add.
//
// Minting a session from a GET is safe here precisely because the identity comes
// from headers only the trusted proxy can set — never from ambient credentials
// the browser would attach on its own. A cross-site request cannot forge them,
// and one arriving through the proxy carries its own sender's certificate.
//
// It is also the method a person can reach by typing the URL, which is why its
// failures return a page rather than JSON.
export async function GET(request: Request): Promise<NextResponse> {
  return signInWithCertificate(request, true);
}

// Kept for callers that drive the exchange directly rather than being redirected
// into it — the mock proxy in mocks/pki/proxy.mjs among them. These get JSON.
export async function POST(request: Request): Promise<NextResponse> {
  return signInWithCertificate(request, false);
}
