import { describe, expect, it } from "vitest";
import { MCP_CREDENTIAL_ENV_PREFIX, isValidMcpCredentialRef } from "./mcp-server";

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
