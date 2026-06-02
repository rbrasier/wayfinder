import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const buildRequest = (pathname: string, sessionToken?: string): NextRequest => {
  const headers = new Headers();
  if (sessionToken) {
    headers.set("cookie", `better-auth.session_token=${sessionToken}`);
  }
  return new NextRequest(new URL(`http://localhost:3000${pathname}`), { headers });
};

describe("middleware — /admin/register redirect for logged-in users", () => {
  it("redirects a request with a session cookie to /admin", () => {
    const response = middleware(buildRequest("/admin/register", "session-token-value"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/admin");
  });

  it("lets an unauthenticated visitor reach /admin/register", () => {
    const response = middleware(buildRequest("/admin/register"));

    expect(response.headers.get("location")).toBeNull();
  });

  it("still allows unauthenticated visitors to reach /admin/login", () => {
    const response = middleware(buildRequest("/admin/login"));

    expect(response.headers.get("location")).toBeNull();
  });
});
