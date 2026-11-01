import type { McpOAuthSettings } from "@wayfinder/domain";
import { describe, expect, it, vi } from "vitest";
import { OAuthClientCredentialsTokenSource } from "./oauth-client-credentials-token-source";

const settings: McpOAuthSettings = {
  tokenUrl: "https://login.example.com/oauth2/token",
  clientId: "wayfinder service",
  scope: null,
  audience: null,
  clientAuthMethod: "client_secret_basic",
};

const tokenResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const setup = (responses: Array<Response | Error>) => {
  let clock = 1_000_000;
  const fetchToken = vi.fn(async (_url: string, _init: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  const source = new OAuthClientCredentialsTokenSource(fetchToken, () => clock);
  return {
    source,
    fetchToken,
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
    sentBody: (call = 0) => new URLSearchParams(String(fetchToken.mock.calls[call]![1].body)),
    sentHeaders: (call = 0) => fetchToken.mock.calls[call]![1].headers as Record<string, string>,
  };
};

describe("OAuthClientCredentialsTokenSource", () => {
  it("requests a client-credentials token with the client ID and secret in an HTTP Basic header", async () => {
    const { source, fetchToken, sentBody, sentHeaders } = setup([
      tokenResponse({ access_token: "token-1", token_type: "Bearer", expires_in: 3600 }),
    ]);

    const result = await source.accessToken("server-1", settings, "s3cret:x");

    expect(result.data).toBe("token-1");
    expect(fetchToken.mock.calls[0]![0]).toBe("https://login.example.com/oauth2/token");
    expect(fetchToken.mock.calls[0]![1].method).toBe("POST");
    expect(sentBody().get("grant_type")).toBe("client_credentials");
    expect(sentBody().has("client_secret")).toBe(false);
    // RFC 6749 §2.3.1: each part is form-encoded before the pair is base64-encoded.
    const expected = Buffer.from("wayfinder+service:s3cret%3Ax").toString("base64");
    expect(sentHeaders().Authorization).toBe(`Basic ${expected}`);
  });

  it("sends the client ID and secret in the form body for client_secret_post", async () => {
    const { source, sentBody, sentHeaders } = setup([tokenResponse({ access_token: "token-1" })]);

    await source.accessToken("server-1", { ...settings, clientAuthMethod: "client_secret_post" }, "s3cret");

    expect(sentBody().get("client_id")).toBe("wayfinder service");
    expect(sentBody().get("client_secret")).toBe("s3cret");
    expect(sentHeaders().Authorization).toBeUndefined();
  });

  it("sends scope, and the audience as both audience and resource, only when set", async () => {
    const { source, sentBody } = setup([
      tokenResponse({ access_token: "token-1" }),
      tokenResponse({ access_token: "token-2" }),
    ]);

    await source.accessToken("server-1", settings, "s3cret");
    expect(sentBody(0).has("scope")).toBe(false);
    expect(sentBody(0).has("audience")).toBe(false);
    expect(sentBody(0).has("resource")).toBe(false);

    await source.accessToken(
      "server-2",
      { ...settings, scope: "mcp.read mcp.write", audience: "https://api.example.com" },
      "s3cret",
    );
    expect(sentBody(1).get("scope")).toBe("mcp.read mcp.write");
    expect(sentBody(1).get("audience")).toBe("https://api.example.com");
    expect(sentBody(1).get("resource")).toBe("https://api.example.com");
  });

  it("reuses a cached token until it is within a minute of expiring, then fetches a new one", async () => {
    const { source, fetchToken, advance } = setup([
      tokenResponse({ access_token: "token-1", expires_in: 3600 }),
      tokenResponse({ access_token: "token-2", expires_in: 3600 }),
    ]);

    await source.accessToken("server-1", settings, "s3cret");
    advance(3600_000 - 61_000);
    const stillCached = await source.accessToken("server-1", settings, "s3cret");
    expect(stillCached.data).toBe("token-1");
    expect(fetchToken).toHaveBeenCalledTimes(1);

    advance(2_000);
    const refreshed = await source.accessToken("server-1", settings, "s3cret");
    expect(refreshed.data).toBe("token-2");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("caches a token that states no lifetime for five minutes", async () => {
    const { source, fetchToken, advance } = setup([
      tokenResponse({ access_token: "token-1" }),
      tokenResponse({ access_token: "token-2" }),
    ]);

    await source.accessToken("server-1", settings, "s3cret");
    advance(3 * 60_000);
    expect((await source.accessToken("server-1", settings, "s3cret")).data).toBe("token-1");

    advance(2 * 60_000);
    expect((await source.accessToken("server-1", settings, "s3cret")).data).toBe("token-2");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("stops using a cached token as soon as the server's settings or secret change", async () => {
    const { source, fetchToken } = setup([
      tokenResponse({ access_token: "token-1", expires_in: 3600 }),
      tokenResponse({ access_token: "token-2", expires_in: 3600 }),
      tokenResponse({ access_token: "token-3", expires_in: 3600 }),
    ]);

    await source.accessToken("server-1", settings, "s3cret");
    const newScope = await source.accessToken("server-1", { ...settings, scope: "mcp.read" }, "s3cret");
    const newSecret = await source.accessToken("server-1", { ...settings, scope: "mcp.read" }, "rotated");

    expect(newScope.data).toBe("token-2");
    expect(newSecret.data).toBe("token-3");
    expect(fetchToken).toHaveBeenCalledTimes(3);
  });

  it("shares one token request between calls made at the same time", async () => {
    const { source, fetchToken } = setup([tokenResponse({ access_token: "token-1", expires_in: 3600 })]);

    const [first, second] = await Promise.all([
      source.accessToken("server-1", settings, "s3cret"),
      source.accessToken("server-1", settings, "s3cret"),
    ]);

    expect(first.data).toBe("token-1");
    expect(second.data).toBe("token-1");
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("reports the provider's OAuth error with the token host, never the secret, and does not cache the failure", async () => {
    const { source, fetchToken } = setup([
      tokenResponse({ error: "invalid_client", error_description: "Client authentication failed." }, 401),
      tokenResponse({ access_token: "token-1" }),
    ]);

    const failed = await source.accessToken("server-1", settings, "s3cret");

    expect(failed.error?.code).toBe("INFRA_FAILURE");
    expect(failed.error?.message).toBe(
      "Couldn't get an access token from login.example.com: invalid_client — Client authentication failed.",
    );
    expect(failed.error?.message).not.toContain("s3cret");

    const retried = await source.accessToken("server-1", settings, "s3cret");
    expect(retried.data).toBe("token-1");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("reports a non-JSON error response by its HTTP status", async () => {
    const { source } = setup([new Response("Bad gateway", { status: 502 })]);

    const result = await source.accessToken("server-1", settings, "s3cret");

    expect(result.error?.message).toBe("Couldn't get an access token from login.example.com: HTTP 502.");
  });

  it("reports an unreachable token endpoint", async () => {
    const { source } = setup([new Error("getaddrinfo ENOTFOUND login.example.com")]);

    const result = await source.accessToken("server-1", settings, "s3cret");

    expect(result.error?.message).toBe(
      "Couldn't get an access token from login.example.com: getaddrinfo ENOTFOUND login.example.com",
    );
  });

  it("rejects a response with no access token, or a token type other than Bearer", async () => {
    const { source } = setup([
      tokenResponse({ token_type: "Bearer" }),
      tokenResponse({ access_token: "token-1", token_type: "mac" }),
    ]);

    const missing = await source.accessToken("server-1", settings, "s3cret");
    const wrongType = await source.accessToken("server-1", settings, "s3cret");

    expect(missing.error?.message).toBe(
      "Couldn't get an access token from login.example.com: the response had no access_token.",
    );
    expect(wrongType.error?.message).toBe(
      'Couldn\'t get an access token from login.example.com: token type "mac" is not supported.',
    );
  });
});
