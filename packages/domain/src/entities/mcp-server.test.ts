import { describe, expect, it } from "vitest";
import {
  DEFAULT_MCP_CALL_TIMEOUT_MS,
  MCP_DATA_CLASSIFICATIONS,
  isFlowUsableClassification,
  isValidMcpCallTimeout,
  validateMcpCustomHeaders,
  validateMcpOAuthSettings,
} from "./mcp-server";

describe("isFlowUsableClassification", () => {
  it("offers internal and public-read servers to flows", () => {
    expect(isFlowUsableClassification("internal")).toBe(true);
    expect(isFlowUsableClassification("public-read")).toBe(true);
  });

  it("keeps servers that send records out of flows", () => {
    expect(isFlowUsableClassification("external-write")).toBe(false);
  });

  it("lists every classification once", () => {
    expect(MCP_DATA_CLASSIFICATIONS).toEqual(["internal", "public-read", "external-write"]);
  });
});

describe("isValidMcpCallTimeout", () => {
  it("accepts the default and the bounds", () => {
    expect(isValidMcpCallTimeout(DEFAULT_MCP_CALL_TIMEOUT_MS)).toBe(true);
    expect(isValidMcpCallTimeout(1_000)).toBe(true);
    expect(isValidMcpCallTimeout(120_000)).toBe(true);
  });

  it("rejects values outside the bounds or not whole milliseconds", () => {
    expect(isValidMcpCallTimeout(999)).toBe(false);
    expect(isValidMcpCallTimeout(120_001)).toBe(false);
    expect(isValidMcpCallTimeout(1_500.5)).toBe(false);
  });
});

describe("validateMcpCustomHeaders", () => {
  it("accepts ordinary headers and trims names", () => {
    const result = validateMcpCustomHeaders({ " X-Api-Key ": "abc", "X-Tenant": "gov" }, false);

    expect(result.data).toEqual({ "X-Api-Key": "abc", "X-Tenant": "gov" });
  });

  it("refuses a header name with characters outside an HTTP token", () => {
    expect(validateMcpCustomHeaders({ "Bad Header": "x" }, false).error?.code).toBe(
      "VALIDATION_FAILED",
    );
  });

  it("refuses headers that would break the transport, whatever their case", () => {
    for (const name of ["Host", "content-length", "Content-Type", "ACCEPT", "Mcp-Session-Id", "mcp-protocol-version", "Last-Event-ID"]) {
      expect(validateMcpCustomHeaders({ [name]: "x" }, false).error?.message).toContain(name);
    }
  });

  it("refuses Authorization only when a bearer token is also set", () => {
    expect(validateMcpCustomHeaders({ Authorization: "Basic abc" }, false).data).toEqual({
      Authorization: "Basic abc",
    });
    expect(validateMcpCustomHeaders({ authorization: "Basic abc" }, true).error?.code).toBe(
      "VALIDATION_FAILED",
    );
  });

  it("refuses an empty name or a value carrying a line break", () => {
    expect(validateMcpCustomHeaders({ " ": "x" }, false).error).toBeDefined();
    expect(validateMcpCustomHeaders({ "X-Key": "a\r\nInjected: 1" }, false).error).toBeDefined();
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
