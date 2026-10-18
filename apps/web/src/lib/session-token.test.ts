import { describe, expect, it } from "vitest";
import { getSessionTokenFromCookieStore, getSessionTokenFromRequest } from "./session-token";

const requestWithCookie = (cookie: string): Request =>
  new Request("http://wayfinder:3000/api/trpc/user.me", { headers: { cookie } });

const cookieStoreOf = (entries: Record<string, string>) => ({
  get: (name: string) => (name in entries ? { value: entries[name] } : undefined),
});

describe("getSessionTokenFromRequest", () => {
  it("reads the plain cookie Better Auth issues for an http BETTER_AUTH_URL", () => {
    const request = requestWithCookie("theme=dark; better-auth.session_token=plain.sig");
    expect(getSessionTokenFromRequest(request)).toBe("plain.sig");
  });

  // Regression: behind a TLS-terminating load balancer with an https
  // BETTER_AUTH_URL, Better Auth names the cookie with the __Secure- prefix.
  // Reading only the plain name left every tRPC call anonymous.
  it("reads the __Secure- cookie Better Auth issues for an https BETTER_AUTH_URL", () => {
    const request = requestWithCookie("theme=dark; __Secure-better-auth.session_token=secure.sig");
    expect(getSessionTokenFromRequest(request)).toBe("secure.sig");
  });

  it("prefers the __Secure- cookie when both are present, as Better Auth does", () => {
    const request = requestWithCookie(
      "better-auth.session_token=stale.sig; __Secure-better-auth.session_token=secure.sig",
    );
    expect(getSessionTokenFromRequest(request)).toBe("secure.sig");
  });

  it("returns null when no session cookie is present", () => {
    expect(getSessionTokenFromRequest(requestWithCookie("theme=dark"))).toBeNull();
    expect(getSessionTokenFromRequest(new Request("http://wayfinder:3000/"))).toBeNull();
  });
});

describe("getSessionTokenFromCookieStore", () => {
  it("reads the __Secure- cookie for an https BETTER_AUTH_URL", () => {
    const store = cookieStoreOf({ "__Secure-better-auth.session_token": "secure.sig" });
    expect(getSessionTokenFromCookieStore(store)).toBe("secure.sig");
  });

  it("reads the plain cookie for an http BETTER_AUTH_URL", () => {
    const store = cookieStoreOf({ "better-auth.session_token": "plain.sig" });
    expect(getSessionTokenFromCookieStore(store)).toBe("plain.sig");
  });

  it("returns null when no session cookie is present", () => {
    expect(getSessionTokenFromCookieStore(cookieStoreOf({}))).toBeNull();
  });
});
