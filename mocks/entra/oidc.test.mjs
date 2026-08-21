import { describe, expect, it } from "vitest";
import { request, response, json } from "../test-support/http.mjs";
import { FEATURED_EMAILS, findEmployeeByEmail, roster } from "../directory/roster.mjs";
import { mock } from "./oidc.mjs";

const TENANT = "mock-tenant";
const REDIRECT_URI = "http://localhost:3000/api/auth/callback/microsoft";

const call = async (method, url, body = null) => {
  const res = response();
  await mock.handle(request(method, url, body), res);
  return res.recorded;
};

const decodeIdToken = (idToken) =>
  JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));

const signIn = async (form) => {
  const authorize = await call(
    "POST",
    `/entra/${TENANT}/oauth2/v2.0/authorize`,
    new URLSearchParams({ redirect_uri: REDIRECT_URI, state: "st", ...form }).toString(),
  );
  const code = new URL(authorize.headers.Location).searchParams.get("code");
  const token = await call(
    "POST",
    `/entra/${TENANT}/oauth2/v2.0/token`,
    new URLSearchParams({ grant_type: "authorization_code", code, client_id: "mock-client" }).toString(),
  );
  return { authorize, token, code };
};

describe("the identity picker", () => {
  const picker = async () =>
    (
      await call(
        "GET",
        `/entra/${TENANT}/oauth2/v2.0/authorize?redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=st`,
      )
    ).body;

  it("offers every featured identity as a one-click button", async () => {
    const body = await picker();
    for (const email of FEATURED_EMAILS) {
      expect(body, email).toContain(email);
    }
    expect(body.match(/data-testid="mock-entra-identity"/g).length).toBe(roster.length);
  });

  it("lists the whole roster, so any employee can sign in", async () => {
    const body = await picker();
    for (const employee of roster) {
      expect(body, employee.email).toContain(employee.email);
    }
  });

  it("keeps the free-typed email escape hatch and its test ids", async () => {
    const body = await picker();
    expect(body).toContain('data-testid="mock-entra-email"');
    expect(body).toContain('data-testid="mock-entra-submit"');
  });

  it("offers a filter over the full list", async () => {
    expect(await picker()).toContain('data-testid="mock-entra-filter"');
  });

  it("400s without a redirect_uri", async () => {
    const recorded = await call("GET", `/entra/${TENANT}/oauth2/v2.0/authorize`);
    expect(recorded.statusCode).toBe(400);
  });
});

describe("the authorization-code flow", () => {
  it("redirects back with a code and the state it was given", async () => {
    const { authorize } = await signIn({ email: "ada@example.com" });
    expect(authorize.statusCode).toBe(302);
    const location = new URL(authorize.headers.Location);
    expect(location.searchParams.get("code")).toBeTruthy();
    expect(location.searchParams.get("state")).toBe("st");
  });

  it("carries the roster's job title and business unit into the id_token", async () => {
    const { token } = await signIn({ email: "ada@example.com" });
    const claims = decodeIdToken(json(token).id_token);
    const ada = findEmployeeByEmail("ada@example.com");
    expect(claims.email).toBe(ada.email);
    expect(claims.name).toBe(ada.name);
    expect(claims.jobTitle).toBe(ada.jobTitle);
    expect(claims.department).toBe(ada.businessUnit);
    expect(claims.tid).toBe(TENANT);
  });

  it("still signs in an email that is in no roster, with no directory claims", async () => {
    const { token } = await signIn({ email: "Stranger@Example.com" });
    const claims = decodeIdToken(json(token).id_token);
    expect(claims.email).toBe("stranger@example.com");
    expect(claims.jobTitle).toBeUndefined();
  });

  it("rejects a reused code", async () => {
    const { code } = await signIn({ email: "grace@example.com" });
    const replay = await call(
      "POST",
      `/entra/${TENANT}/oauth2/v2.0/token`,
      new URLSearchParams({ grant_type: "authorization_code", code }).toString(),
    );
    expect(replay.statusCode).toBe(400);
    expect(json(replay).error).toBe("invalid_grant");
  });

  it("400s a submission with no email", async () => {
    const recorded = await call(
      "POST",
      `/entra/${TENANT}/oauth2/v2.0/authorize`,
      new URLSearchParams({ redirect_uri: REDIRECT_URI }).toString(),
    );
    expect(recorded.statusCode).toBe(400);
  });
});

describe("the client-credentials grant", () => {
  it("issues an access token with no authorization code, so the mock Graph is reachable", async () => {
    const recorded = await call(
      "POST",
      `/entra/${TENANT}/oauth2/v2.0/token`,
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: "mock-client",
        client_secret: "mock-secret",
        scope: "https://graph.microsoft.com/.default",
      }).toString(),
    );
    expect(recorded.statusCode).toBe(200);
    const payload = json(recorded);
    expect(payload.access_token).toBeTruthy();
    expect(payload.token_type).toBe("Bearer");
    expect(payload.expires_in).toBeGreaterThan(0);
    expect(payload.id_token).toBeUndefined();
  });
});

describe("routing", () => {
  it("serves an empty JWKS for completeness", async () => {
    const recorded = await call("GET", `/entra/${TENANT}/discovery/v2.0/keys`);
    expect(json(recorded)).toEqual({ keys: [] });
  });

  it("404s without a tenant segment", async () => {
    expect((await call("GET", "/entra")).statusCode).toBe(404);
  });
});
