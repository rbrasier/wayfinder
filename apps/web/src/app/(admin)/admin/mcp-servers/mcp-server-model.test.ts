import { describe, expect, it } from "vitest";
import {
  EMPTY_OAUTH_FIELDS,
  credentialSummary,
  oauthFieldsOf,
  serverFormProblems,
  signInChange,
  signInMethodOf,
  signInProblems,
} from "./mcp-server-model";

const oauthSettings = {
  tokenUrl: "https://login.example.com/token",
  clientId: "wayfinder-service",
  scope: "mcp.read",
  audience: null,
  clientAuthMethod: "client_secret_basic" as const,
};

const oauthFields = {
  ...EMPTY_OAUTH_FIELDS,
  tokenUrl: " https://login.example.com/token ",
  clientId: " wayfinder-service ",
  clientSecret: " s3cret ",
};

describe("credentialSummary", () => {
  it("names OAuth client credentials by their client ID", () => {
    expect(credentialSummary({ hasCredential: false, credentialRef: null, oauth: oauthSettings })).toEqual({
      kind: "oauth",
      text: "OAuth client credentials (wayfinder-service)",
    });
  });

  it("says a stored token is stored, whatever legacy reference remains", () => {
    expect(credentialSummary({ hasCredential: true, credentialRef: null, oauth: null })).toEqual({
      kind: "stored",
      text: "Stored securely",
    });
  });

  it("names the environment variable of a legacy server", () => {
    expect(credentialSummary({ hasCredential: false, credentialRef: "MCP_CRED_GITHUB", oauth: null })).toEqual({
      kind: "legacy",
      text: "Env var MCP_CRED_GITHUB (legacy)",
    });
  });

  it("reports no token", () => {
    expect(credentialSummary({ hasCredential: false, credentialRef: null, oauth: null })).toEqual({
      kind: "none",
      text: "—",
    });
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

describe("signInMethodOf", () => {
  it("reads OAuth, a stored or legacy token, or nothing", () => {
    expect(signInMethodOf({ hasCredential: false, credentialRef: null, oauth: oauthSettings })).toBe("oauth");
    expect(signInMethodOf({ hasCredential: true, credentialRef: null, oauth: null })).toBe("bearer");
    expect(signInMethodOf({ hasCredential: false, credentialRef: "MCP_CRED_X", oauth: null })).toBe("bearer");
    expect(signInMethodOf({ hasCredential: false, credentialRef: null, oauth: null })).toBe("none");
  });
});

describe("oauthFieldsOf", () => {
  it("fills the form from stored settings, leaving the secret blank", () => {
    expect(oauthFieldsOf(oauthSettings)).toEqual({
      tokenUrl: "https://login.example.com/token",
      clientId: "wayfinder-service",
      clientSecret: "",
      scope: "mcp.read",
      audience: "",
      clientAuthMethod: "client_secret_basic",
    });
  });

  it("starts empty, on HTTP Basic, for a server without OAuth", () => {
    expect(oauthFieldsOf(null)).toEqual(EMPTY_OAUTH_FIELDS);
  });
});

describe("signInChange", () => {
  it("sends trimmed OAuth settings, with a blank secret omitted so the stored one is kept", () => {
    expect(signInChange("oauth", { token: "", oauth: { ...oauthFields, clientSecret: " " } }, "oauth")).toEqual({
      oauth: {
        tokenUrl: "https://login.example.com/token",
        clientId: "wayfinder-service",
        scope: null,
        audience: null,
        clientAuthMethod: "client_secret_basic",
      },
    });
  });

  it("sends a typed client secret", () => {
    expect(signInChange("oauth", { token: "", oauth: oauthFields }, "none").oauth?.clientSecret).toBe("s3cret");
  });

  it("sends a typed bearer token, and drops OAuth when switching away from it", () => {
    expect(signInChange("bearer", { token: " t ", oauth: EMPTY_OAUTH_FIELDS }, "bearer")).toEqual({ credential: "t" });
    expect(signInChange("bearer", { token: "t", oauth: EMPTY_OAUTH_FIELDS }, "oauth")).toEqual({
      credential: "t",
      oauth: null,
    });
  });

  it("keeps a stored bearer token when the field is left blank", () => {
    expect(signInChange("bearer", { token: "", oauth: EMPTY_OAUTH_FIELDS }, "bearer")).toEqual({});
  });

  it("removes every way of signing in for None", () => {
    expect(signInChange("none", { token: "x", oauth: oauthFields }, "oauth")).toEqual({
      credential: null,
      oauth: null,
    });
  });
});

describe("signInProblems", () => {
  it("asks for a bearer token unless one is already stored", () => {
    expect(signInProblems("bearer", { token: " ", oauth: EMPTY_OAUTH_FIELDS }, "none")).toEqual([
      { field: "token", message: "Enter the token." },
    ]);
    expect(signInProblems("bearer", { token: "", oauth: EMPTY_OAUTH_FIELDS }, "bearer")).toEqual([]);
  });

  it("asks for a token URL, client ID and client secret for OAuth", () => {
    expect(signInProblems("oauth", { token: "", oauth: EMPTY_OAUTH_FIELDS }, "none")).toEqual([
      { field: "tokenUrl", message: "Use an http:// or https:// address." },
      { field: "clientId", message: "Enter the client ID." },
      { field: "clientSecret", message: "Enter the client secret." },
    ]);
  });

  it("lets an OAuth server keep its stored secret", () => {
    expect(signInProblems("oauth", { token: "", oauth: { ...oauthFields, clientSecret: "" } }, "oauth")).toEqual([]);
  });

  it("has nothing to check for None", () => {
    expect(signInProblems("none", { token: "", oauth: EMPTY_OAUTH_FIELDS }, "none")).toEqual([]);
  });
});
