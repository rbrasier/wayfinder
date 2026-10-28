import { domainError, err, ok, type McpServer } from "@rbrasier/domain";
import { describe, expect, it, vi } from "vitest";
import { McpBearerTokenResolver } from "./mcp-bearer-token-resolver";

const serverWith = (overrides: Partial<McpServer>): McpServer => ({
  id: "server-1",
  label: "Records",
  transport: "sse",
  url: "https://mcp.example.com/sse",
  credentialRef: null,
  hasCredential: false,
  oauth: null,
  communicatesExternally: false,
  status: "active",
  createdByUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const oauth = {
  tokenUrl: "https://login.example.com/token",
  clientId: "wayfinder-service",
  scope: null,
  audience: null,
  clientAuthMethod: "client_secret_basic" as const,
};

const setup = () => {
  const credentials = {
    readCredential: vi.fn(async () => ok<string | null>("stored-token")),
    readOAuthClientSecret: vi.fn(async () => ok<string | null>("client-secret")),
  };
  const tokenSource = { accessToken: vi.fn(async () => ok("fetched-token")) };
  return { credentials, tokenSource, resolver: new McpBearerTokenResolver(credentials, tokenSource) };
};

describe("McpBearerTokenResolver", () => {
  it("sends no token for a server without one", async () => {
    const { resolver, credentials } = setup();

    const result = await resolver.resolve(serverWith({}));

    expect(result.data).toBeNull();
    expect(credentials.readCredential).not.toHaveBeenCalled();
  });

  it("sends the stored bearer token", async () => {
    const { resolver } = setup();

    const result = await resolver.resolve(serverWith({ hasCredential: true }));

    expect(result.data).toBe("stored-token");
  });

  it("fetches an access token with the stored client secret for an OAuth server", async () => {
    const { resolver, tokenSource, credentials } = setup();

    const result = await resolver.resolve(serverWith({ oauth }));

    expect(result.data).toBe("fetched-token");
    expect(credentials.readOAuthClientSecret).toHaveBeenCalledWith("server-1");
    expect(tokenSource.accessToken).toHaveBeenCalledWith("server-1", oauth, "client-secret");
    expect(credentials.readCredential).not.toHaveBeenCalled();
  });

  it("fails an OAuth server whose client secret is missing rather than calling it unauthenticated", async () => {
    const { resolver, credentials, tokenSource } = setup();
    credentials.readOAuthClientSecret.mockResolvedValueOnce(ok(null));

    const result = await resolver.resolve(serverWith({ oauth }));

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(tokenSource.accessToken).not.toHaveBeenCalled();
  });

  it("passes a token request failure through", async () => {
    const { resolver, tokenSource } = setup();
    tokenSource.accessToken.mockResolvedValueOnce(err(domainError("INFRA_FAILURE", "no token")) as never);

    const result = await resolver.resolve(serverWith({ oauth }));

    expect(result.error?.message).toBe("no token");
  });
});
