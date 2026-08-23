import { describe, expect, it } from "vitest";
import { formOwning, formStructure, json, request, response } from "../test-support/http.mjs";
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

  it("offers a toggle for an unverified email domain", async () => {
    expect(await picker()).toContain('data-testid="mock-entra-unverified"');
  });

  it("offers a filter over the full list", async () => {
    expect(await picker()).toContain('data-testid="mock-entra-filter"');
  });

  it("closes every form it opens", async () => {
    const structure = formStructure(await picker());
    expect(structure.unclosed).toBe(false);
    // An unclosed form is ignored by the parser rather than nested, so the
    // buttons after it post the *first* form's hidden fields. That is how a
    // typed address silently signed in as whoever heads the list.
    expect(structure.swallowed).toEqual([]);
    // Three forms only: the filter, the identity list, and the free-typed
    // address. Not one per identity.
    expect(structure.opened).toBe(4);
  });

  it("keeps the free-typed address in a form of its own, with no identity attached", async () => {
    const body = await picker();
    const form = formOwning(body, "mock-entra-email");
    expect(form).toContain('data-testid="mock-entra-submit"');
    expect(form).not.toContain('type="hidden" name="email"');
    expect(form).not.toContain('data-testid="mock-entra-identity"');
  });

  it("carries each identity on its own submit button, exactly once", async () => {
    const body = await picker();
    for (const employee of [roster[0], roster[50], roster.at(-1)]) {
      const button = `<button type="submit" name="email" value="${employee.email}"`;
      expect(body.split(button).length - 1, employee.email).toBe(1);
    }
  });

  it("keeps the identity list light enough not to slow a browser down", async () => {
    const body = await picker();
    // A guard against per-row duplication creeping back, not a byte target.
    // Rendering a form, three hidden inputs and a duplicated search attribute
    // for each of 100 rows put this at 62 KB and 818 elements, on a page the
    // Entra e2e specs load and screenshot full-page.
    // A fixed handful for the four forms — never one per identity.
    expect((body.match(/<input\b/g) ?? []).length).toBeLessThan(15);
    expect((body.match(/<[a-z]/g) ?? []).length).toBeLessThan(500);
    expect(body.length).toBeLessThan(35_000);
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

  it("issues the claims a real v2.0 id_token carries", async () => {
    const { token } = await signIn({ email: "ada@example.com" });
    const claims = decodeIdToken(json(token).id_token);
    // Entra v2.0 issues an https issuer URI ending in /v2.0, a per-tenant object
    // id, and a version marker. Better Auth reads `sub`; the rest exist so the
    // mock does not teach a shape production will not deliver.
    expect(claims.iss).toMatch(/^https?:\/\/[^/]+\/entra\/mock-tenant\/v2\.0$/);
    expect(claims.ver).toBe("2.0");
    expect(claims.oid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(claims.nbf).toBe(claims.iat);
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  it("sends neither email_verified nor xms_edov by default, as a stock tenant does", async () => {
    const { token } = await signIn({ email: "ada@example.com" });
    const claims = decodeIdToken(json(token).id_token);
    // `email_verified` is not a v2.0 claim at all, and `xms_edov` is an optional
    // claim a tenant has to turn on. Absent both, the app trusts the identity.
    expect(claims.email_verified).toBeUndefined();
    expect(claims.xms_edov).toBeUndefined();
  });

  it("sends xms_edov: false on request, so the unverified branch is reachable", async () => {
    const { token } = await signIn({ email: "ada@example.com", unverified: "1" });
    const claims = decodeIdToken(json(token).id_token);
    expect(claims.xms_edov).toBe(false);
  });

  it("issues an opaque subject that does not leak the address, and is stable per identity", async () => {
    const first = decodeIdToken(json((await signIn({ email: "ada@example.com" })).token).id_token);
    const second = decodeIdToken(json((await signIn({ email: "ada@example.com" })).token).id_token);
    // Real Entra's `sub` is a pairwise, opaque identifier — not derived from the
    // address. Stable across sign-ins, or account linking would break.
    expect(first.sub).not.toContain("ada@example.com");
    expect(first.sub).toBe(second.sub);
    expect(first.oid).toBe(second.oid);

    const other = decodeIdToken(json((await signIn({ email: "grace@example.com" })).token).id_token);
    expect(other.sub).not.toBe(first.sub);
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

// probeAuthEntra fetches the discovery document to find the token endpoint
// before it will attempt a client-credentials grant, so a mock without one
// fails the Authentication card's Test with HTTP 404 while sign-in itself works.
describe("the OpenID discovery document", () => {
  it("is served at the v2.0 well-known path the sign-in probe asks for", async () => {
    const recorded = await call("GET", `/entra/${TENANT}/v2.0/.well-known/openid-configuration`);

    expect(recorded.statusCode).toBe(200);
    expect(json(recorded).token_endpoint).toBe(
      `http://localhost:4001/entra/${TENANT}/oauth2/v2.0/token`,
    );
  });

  it("is served at the tenant-root well-known path too, as the real authority is", async () => {
    const recorded = await call("GET", `/entra/${TENANT}/.well-known/openid-configuration`);

    expect(recorded.statusCode).toBe(200);
    expect(json(recorded).token_endpoint).toBeTruthy();
  });

  it("points every endpoint back at the mock, never at Microsoft", async () => {
    const document = json(await call("GET", `/entra/${TENANT}/v2.0/.well-known/openid-configuration`));

    for (const endpoint of [
      document.authorization_endpoint,
      document.token_endpoint,
      document.jwks_uri,
    ]) {
      expect(endpoint).toContain(`/entra/${TENANT}/`);
      expect(endpoint).not.toContain("microsoftonline.com");
    }
  });

  it("names the tenant in the issuer, as a v2.0 authority does", async () => {
    const document = json(await call("GET", `/entra/${TENANT}/v2.0/.well-known/openid-configuration`));

    expect(document.issuer).toBe(`http://localhost:4001/entra/${TENANT}/v2.0`);
  });

  it("advertises the token endpoint the client-credentials grant actually answers on", async () => {
    const document = json(await call("GET", `/entra/${TENANT}/v2.0/.well-known/openid-configuration`));
    const path = new URL(document.token_endpoint).pathname;

    const token = await call(
      "POST",
      path,
      new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    );

    expect(token.statusCode).toBe(200);
    expect(json(token).access_token).toBeTruthy();
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
