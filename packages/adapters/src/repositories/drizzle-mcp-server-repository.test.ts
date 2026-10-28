import { describe, expect, it } from "vitest";
import { oauthColumns, toMcpServer } from "./drizzle-mcp-server-repository";

const cipher = {
  encrypt: (plain: string) => `enc:${plain}`,
  decrypt: (encrypted: string) => encrypted.replace(/^enc:/, ""),
};

const row = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "server-1",
    label: "Records",
    transport: "sse",
    url: "https://mcp.example.com/sse",
    credential_ref: null,
    credential_encrypted: null,
    oauth_token_url: null,
    oauth_client_id: null,
    oauth_client_secret_encrypted: null,
    oauth_scope: null,
    oauth_audience: null,
    oauth_client_auth_method: null,
    communicates_externally: false,
    status: "active",
    created_by_user_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  }) as Parameters<typeof toMcpServer>[0];

const settings = {
  tokenUrl: "https://login.example.com/token",
  clientId: "wayfinder-service",
  scope: "mcp.read",
  audience: null,
  clientAuthMethod: "client_secret_post" as const,
};

describe("toMcpServer", () => {
  it("reads a server with no OAuth columns as not using OAuth", () => {
    expect(toMcpServer(row()).oauth).toBeNull();
  });

  it("carries the OAuth settings but never the client secret", () => {
    const server = toMcpServer(
      row({
        oauth_token_url: "https://login.example.com/token",
        oauth_client_id: "wayfinder-service",
        oauth_client_secret_encrypted: "enc:client-secret",
        oauth_scope: "mcp.read",
        oauth_client_auth_method: "client_secret_post",
      }),
    );

    expect(server.oauth).toEqual(settings);
    expect(JSON.stringify(server)).not.toContain("client-secret");
  });
});

describe("oauthColumns", () => {
  it("leaves every OAuth column alone when there is no change", () => {
    expect(oauthColumns(undefined, cipher)).toEqual({});
  });

  it("clears every OAuth column, the secret included, when OAuth is removed", () => {
    expect(oauthColumns(null, cipher)).toEqual({
      oauth_token_url: null,
      oauth_client_id: null,
      oauth_client_secret_encrypted: null,
      oauth_scope: null,
      oauth_audience: null,
      oauth_client_auth_method: null,
    });
  });

  it("writes the settings and encrypts a new client secret", () => {
    expect(oauthColumns({ settings, clientSecret: "client-secret" }, cipher)).toEqual({
      oauth_token_url: "https://login.example.com/token",
      oauth_client_id: "wayfinder-service",
      oauth_scope: "mcp.read",
      oauth_audience: null,
      oauth_client_auth_method: "client_secret_post",
      oauth_client_secret_encrypted: "enc:client-secret",
    });
  });

  it("keeps the stored client secret when none is given", () => {
    expect(oauthColumns({ settings }, cipher)).not.toHaveProperty("oauth_client_secret_encrypted");
  });
});
