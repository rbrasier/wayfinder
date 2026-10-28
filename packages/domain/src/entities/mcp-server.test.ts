import { describe, expect, it } from "vitest";
import { MCP_CREDENTIAL_ENV_PREFIX, isValidMcpCredentialRef, validateMcpOAuthSettings } from "./mcp-server";

describe("isValidMcpCredentialRef", () => {
  it("accepts a reference inside the MCP_CRED_ namespace", () => {
    expect(isValidMcpCredentialRef(`${MCP_CREDENTIAL_ENV_PREFIX}GITHUB`)).toBe(true);
  });

  it("rejects an arbitrary process env var name", () => {
    expect(isValidMcpCredentialRef("DATABASE_URL")).toBe(false);
    expect(isValidMcpCredentialRef("AWS_SECRET_ACCESS_KEY")).toBe(false);
  });

  it("rejects the bare prefix with no name after it", () => {
    expect(isValidMcpCredentialRef(MCP_CREDENTIAL_ENV_PREFIX)).toBe(false);
  });
});

describe("validateMcpOAuthSettings", () => {
  const complete = {
    tokenUrl: " https://login.example.com/oauth2/token ",
    clientId: " wayfinder-service ",
    clientSecret: " s3cret ",
  };

  it("accepts complete settings, trims them and defaults to HTTP Basic client authentication", () => {
    const result = validateMcpOAuthSettings(complete, false);

    expect(result.data).toEqual({
      settings: {
        tokenUrl: "https://login.example.com/oauth2/token",
        clientId: "wayfinder-service",
        scope: null,
        audience: null,
        clientAuthMethod: "client_secret_basic",
      },
      clientSecret: "s3cret",
    });
  });

  it("keeps scope, audience and a form-body auth method when given, and blanks read as unset", () => {
    const withExtras = validateMcpOAuthSettings(
      { ...complete, scope: " api.read api.write ", audience: "https://api.example.com", clientAuthMethod: "client_secret_post" },
      false,
    );
    expect(withExtras.data?.settings).toMatchObject({
      scope: "api.read api.write",
      audience: "https://api.example.com",
      clientAuthMethod: "client_secret_post",
    });

    const withBlanks = validateMcpOAuthSettings({ ...complete, scope: "  ", audience: "" }, false);
    expect(withBlanks.data?.settings).toMatchObject({ scope: null, audience: null });
  });

  it("rejects a token URL that is not http(s)", () => {
    const result = validateMcpOAuthSettings({ ...complete, tokenUrl: "ftp://login.example.com/token" }, false);
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("requires a client ID", () => {
    const result = validateMcpOAuthSettings({ ...complete, clientId: "  " }, false);
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("requires a client secret when none is stored yet", () => {
    const result = validateMcpOAuthSettings({ ...complete, clientSecret: " " }, false);
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("keeps the stored client secret when the field is left blank", () => {
    const result = validateMcpOAuthSettings({ ...complete, clientSecret: "" }, true);
    expect(result.data).toBeDefined();
    expect(result.data?.clientSecret).toBeUndefined();
  });

  it("rejects an unknown client authentication method", () => {
    const result = validateMcpOAuthSettings(
      { ...complete, clientAuthMethod: "private_key_jwt" as never },
      false,
    );
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});
