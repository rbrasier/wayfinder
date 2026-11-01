import { describe, expect, it } from "vitest";
import {
  EMPTY_OAUTH_FIELDS,
  CLASSIFICATION_OPTIONS,
  classificationBadge,
  credentialSummary,
  formatHeaderNames,
  oauthFieldsOf,
  parseCustomHeaders,
  parseStatusMeanings,
  secondsToTimeoutMs,
  signInChange,
  signInMethodOf,
  signInProblems,
  timeoutMsToSeconds,
  toolSettingsFromForm,
  toolSettingsToForm,
} from "./mcp-server-form-model";

describe("classification copy", () => {
  it("offers the three classifications with an explanation each", () => {
    expect(CLASSIFICATION_OPTIONS.map((option) => option.value)).toEqual(["internal", "public-read", "external-write"]);
    for (const option of CLASSIFICATION_OPTIONS) expect(option.description.length).toBeGreaterThan(20);
  });

  it("says which classifications flows can use", () => {
    expect(classificationBadge("internal")).toEqual({ label: "Internal", usableInFlows: true });
    expect(classificationBadge("public-read")).toEqual({ label: "Public data", usableInFlows: true });
    expect(classificationBadge("external-write")).toEqual({ label: "Sends records out", usableInFlows: false });
  });
});

describe("timeout", () => {
  it("converts between the seconds an admin types and stored milliseconds", () => {
    expect(secondsToTimeoutMs("45")).toBe(45_000);
    expect(timeoutMsToSeconds(30_000)).toBe("30");
  });

  it("reads a blank or non-numeric entry as no value", () => {
    expect(secondsToTimeoutMs(" ")).toBeUndefined();
    expect(secondsToTimeoutMs("soon")).toBeUndefined();
  });
});

describe("parseCustomHeaders", () => {
  it("reads one Name: value header per line", () => {
    expect(parseCustomHeaders("X-Api-Key: abc\n\nX-Tenant:  gov:uk ")).toEqual({
      headers: { "X-Api-Key": "abc", "X-Tenant": "gov:uk" },
      error: null,
    });
  });

  it("reports a line with no colon", () => {
    expect(parseCustomHeaders("X-Api-Key abc").error).toContain("X-Api-Key abc");
  });

  it("reads empty text as no headers", () => {
    expect(parseCustomHeaders("  ")).toEqual({ headers: {}, error: null });
  });
});

describe("credential summary", () => {
  it("names what is saved without any value", () => {
    expect(credentialSummary({ hasCredential: true, customHeaderNames: ["X-Api-Key"], oauth: null })).toBe(
      "Token saved · headers: X-Api-Key",
    );
    expect(credentialSummary({ hasCredential: false, customHeaderNames: [], oauth: null })).toBe("—");
    expect(formatHeaderNames(["A", "B"])).toBe("A, B");
  });

  it("names OAuth client credentials by their client ID", () => {
    expect(credentialSummary({ hasCredential: false, customHeaderNames: ["X-Tenant"], oauth: oauthSettings })).toBe(
      "OAuth client credentials (wayfinder-service) · headers: X-Tenant",
    );
  });
});

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

describe("sign-in method", () => {
  it("reads OAuth, a saved token, or nothing", () => {
    expect(signInMethodOf({ hasCredential: false, oauth: oauthSettings })).toBe("oauth");
    expect(signInMethodOf({ hasCredential: true, oauth: null })).toBe("bearer");
    expect(signInMethodOf({ hasCredential: false, oauth: null })).toBe("none");
  });

  it("fills the OAuth form from saved settings, leaving the secret blank, or starts empty on HTTP Basic", () => {
    expect(oauthFieldsOf(oauthSettings)).toEqual({
      tokenUrl: "https://login.example.com/token",
      clientId: "wayfinder-service",
      clientSecret: "",
      scope: "mcp.read",
      audience: "",
      clientAuthMethod: "client_secret_basic",
    });
    expect(oauthFieldsOf(null)).toEqual(EMPTY_OAUTH_FIELDS);
  });
});

describe("signInChange", () => {
  it("sends trimmed OAuth settings, leaving out a blank secret so the saved one is kept", () => {
    expect(signInChange("oauth", { token: "", oauth: { ...oauthFields, clientSecret: " " } }, "oauth")).toEqual({
      oauth: {
        tokenUrl: "https://login.example.com/token",
        clientId: "wayfinder-service",
        scope: null,
        audience: null,
        clientAuthMethod: "client_secret_basic",
      },
    });
    expect(signInChange("oauth", { token: "", oauth: oauthFields }, "none").oauth?.clientSecret).toBe("s3cret");
  });

  it("sends a typed bearer token, keeps a saved one when blank, and drops OAuth when switching away", () => {
    expect(signInChange("bearer", { token: " t ", oauth: EMPTY_OAUTH_FIELDS }, "bearer")).toEqual({ bearerToken: "t" });
    expect(signInChange("bearer", { token: "", oauth: EMPTY_OAUTH_FIELDS }, "bearer")).toEqual({});
    expect(signInChange("bearer", { token: "t", oauth: EMPTY_OAUTH_FIELDS }, "oauth")).toEqual({
      bearerToken: "t",
      oauth: null,
    });
  });

  it("removes every way of signing in for None", () => {
    expect(signInChange("none", { token: "x", oauth: oauthFields }, "oauth")).toEqual({ bearerToken: null, oauth: null });
  });
});

describe("signInProblems", () => {
  it("asks for a bearer token unless one is saved", () => {
    expect(signInProblems("bearer", { token: " ", oauth: EMPTY_OAUTH_FIELDS }, "none")).toEqual(["Enter the token."]);
    expect(signInProblems("bearer", { token: "", oauth: EMPTY_OAUTH_FIELDS }, "bearer")).toEqual([]);
  });

  it("asks for a token URL, client ID and client secret for OAuth, but lets a saved secret stand", () => {
    expect(signInProblems("oauth", { token: "", oauth: EMPTY_OAUTH_FIELDS }, "none")).toEqual([
      "Use an http:// or https:// address for the token URL.",
      "Enter the client ID.",
      "Enter the client secret.",
    ]);
    expect(signInProblems("oauth", { token: "", oauth: { ...oauthFields, clientSecret: "" } }, "oauth")).toEqual([]);
  });

  it("has nothing to check for None", () => {
    expect(signInProblems("none", { token: "", oauth: EMPTY_OAUTH_FIELDS }, "none")).toEqual([]);
  });
});

describe("parseStatusMeanings", () => {
  it("reads value = meaning lines", () => {
    expect(parseStatusMeanings("no_data = no-data\nsource_unavailable=source-unavailable")).toEqual({
      meanings: { no_data: "no-data", source_unavailable: "source-unavailable" },
      error: null,
    });
  });

  it("reports an unknown meaning", () => {
    expect(parseStatusMeanings("down = broken").error).toContain("broken");
  });
});

describe("tool settings form", () => {
  const settings = {
    pagination: { cursorArgument: "cursor", nextCursorPath: "next_cursor", itemsPath: "items", maxPages: 3 },
    status: { statusPath: "status", meanings: { no_data: "no-data" as const }, caveatsPath: "caveats" },
    citation: { recordsPath: "items", locatorField: "id", titleField: "title", urlField: "url", timestampField: null },
  };

  it("round-trips settings through the form", () => {
    expect(toolSettingsFromForm(toolSettingsToForm(settings))).toEqual({ settings, error: null });
  });

  it("turns a section off when its required field is blank", () => {
    const form = { ...toolSettingsToForm(settings), cursorArgument: "", statusPath: "", recordsPath: "" };

    expect(toolSettingsFromForm(form)).toEqual({
      settings: { pagination: null, status: null, citation: null },
      error: null,
    });
  });

  it("reports a page limit that is not a whole number", () => {
    expect(toolSettingsFromForm({ ...toolSettingsToForm(settings), maxPages: "lots" }).error).toContain("page limit");
  });
});
