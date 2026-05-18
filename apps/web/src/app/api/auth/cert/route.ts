import { NextResponse } from "next/server";
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

function extractSourceIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const last = forwarded.split(",").at(-1)?.trim();
    if (last) return last;
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: Request): Promise<NextResponse> {
  const container = getContainer();

  if (!container.pkiCertAdapter) {
    return NextResponse.json({ error: "PKI auth is not enabled." }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const redirectTo = safeRedirectPath(searchParams.get("redirect"));
  const sourceIp = extractSourceIp(request);

  const result = await container.pkiCertAdapter.authenticate(request.headers, sourceIp);

  if (result.error) {
    const status = result.error.code === "UNAUTHORIZED" ? 401 : 400;
    return NextResponse.json({ error: result.error.message }, { status });
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
