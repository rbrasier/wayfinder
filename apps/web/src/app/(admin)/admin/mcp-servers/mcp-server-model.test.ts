import { describe, expect, it } from "vitest";
import { credentialChange, credentialSummary, serverFormProblems } from "./mcp-server-model";

describe("credentialSummary", () => {
  it("says a stored token is stored, whatever legacy reference remains", () => {
    expect(credentialSummary({ hasCredential: true, credentialRef: null })).toEqual({
      kind: "stored",
      text: "Stored securely",
    });
  });

  it("names the environment variable of a legacy server", () => {
    expect(credentialSummary({ hasCredential: false, credentialRef: "MCP_CRED_GITHUB" })).toEqual({
      kind: "legacy",
      text: "Env var MCP_CRED_GITHUB (legacy)",
    });
  });

  it("reports no token", () => {
    expect(credentialSummary({ hasCredential: false, credentialRef: null })).toEqual({
      kind: "none",
      text: "—",
    });
  });
});

describe("credentialChange", () => {
  it("keeps the stored token when the field is left blank", () => {
    expect(credentialChange({ token: "  ", remove: false })).toBeUndefined();
  });

  it("sends a typed token", () => {
    expect(credentialChange({ token: " ghp_new ", remove: false })).toBe("ghp_new");
  });

  it("removes the token when asked, ignoring anything typed", () => {
    expect(credentialChange({ token: "ghp_new", remove: true })).toBeNull();
  });
});

describe("serverFormProblems", () => {
  it("asks for a label and an http(s) address", () => {
    expect(serverFormProblems({ label: " ", url: "ftp://x" })).toEqual([
      { field: "label", message: "Add a label." },
      { field: "url", message: "Use an http:// or https:// address." },
    ]);
  });

  it("accepts a labelled https server", () => {
    expect(serverFormProblems({ label: "GitHub", url: "https://mcp.example.com/sse" })).toEqual([]);
  });
});
