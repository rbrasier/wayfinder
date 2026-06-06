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

describe("middleware — /register access", () => {
  it("does not redirect /register to /admin even when a session cookie is present", () => {
    // Middleware cannot validate session expiry against the DB, so it must never
    // redirect /register. The register page server component handles auth redirects.
    const response = middleware(buildRequest("/register", "any-token-value"));

    expect(response.headers.get("location")).toBeNull();
  });

  it("lets an unauthenticated visitor reach /register", () => {
    const response = middleware(buildRequest("/register"));

    expect(response.headers.get("location")).toBeNull();
  });
});

describe("middleware — /login access", () => {
  it("lets an unauthenticated visitor reach /login", () => {
    const response = middleware(buildRequest("/login"));

    expect(response.headers.get("location")).toBeNull();
  });
});

describe("middleware — protected routes", () => {
  it("redirects unauthenticated access to a protected route to /login", () => {
    const response = middleware(buildRequest("/chats"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
  });

  it("allows access to a protected route when a session cookie is present", () => {
    // Session validity is checked server-side in the layout, not in middleware.
    const response = middleware(buildRequest("/chats", "any-token-value"));

    expect(response.headers.get("location")).toBeNull();
  });
});
