import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIEM_CONFIG,
  createDefaultAuthConfig,
  isAtLeastOneMethodEnabled,
  isEntraConfigured,
  isSiemConfigured,
  parseSiemConfig,
  type AuthConfig,
} from "./runtime-config";

describe("AuthConfig defaults", () => {
  it("enables email/password and disables Entra by default", () => {
    const config = createDefaultAuthConfig();

    expect(config.emailPasswordEnabled).toBe(true);
    expect(config.entraEnabled).toBe(false);
  });

  it("starts with blank Entra credentials", () => {
    const config = createDefaultAuthConfig();

    expect(config.entra).toEqual({ tenantId: "", clientId: "", clientSecret: "" });
  });
});

describe("isEntraConfigured", () => {
  it("is true only when tenant, client and secret are all present", () => {
    expect(
      isEntraConfigured({ tenantId: "t", clientId: "c", clientSecret: "s" }),
    ).toBe(true);
  });

  it("is false when any credential is blank", () => {
    expect(isEntraConfigured({ tenantId: "t", clientId: "c", clientSecret: "" })).toBe(false);
    expect(isEntraConfigured({ tenantId: "t", clientId: "", clientSecret: "s" })).toBe(false);
    expect(isEntraConfigured({ tenantId: "", clientId: "c", clientSecret: "s" })).toBe(false);
  });
});

describe("isAtLeastOneMethodEnabled", () => {
  const blankEntra = { tenantId: "", clientId: "", clientSecret: "" };

  it("is true when only email/password is enabled", () => {
    const config: AuthConfig = { emailPasswordEnabled: true, entraEnabled: false, entra: blankEntra };

    expect(isAtLeastOneMethodEnabled(config)).toBe(true);
  });

  it("is true when only Entra is enabled", () => {
    const config: AuthConfig = { emailPasswordEnabled: false, entraEnabled: true, entra: blankEntra };

    expect(isAtLeastOneMethodEnabled(config)).toBe(true);
  });

  it("is false when both methods are disabled", () => {
    const config: AuthConfig = { emailPasswordEnabled: false, entraEnabled: false, entra: blankEntra };

    expect(isAtLeastOneMethodEnabled(config)).toBe(false);
  });
});

describe("parseSiemConfig", () => {
  it("falls back to disabled defaults on malformed JSON", () => {
    expect(parseSiemConfig("not json")).toEqual(DEFAULT_SIEM_CONFIG);
  });

  it("reads a well-formed config", () => {
    const config = parseSiemConfig(
      JSON.stringify({ enabled: true, endpoint: "https://siem.example/hec", format: "cef", token: "secret" }),
    );
    expect(config).toEqual({
      enabled: true,
      endpoint: "https://siem.example/hec",
      format: "cef",
      token: "secret",
    });
  });

  it("ignores an unknown format and keeps the fallback", () => {
    const config = parseSiemConfig(JSON.stringify({ format: "syslog" }));
    expect(config.format).toBe("json");
  });
});

describe("isSiemConfigured", () => {
  it("is true only when enabled with an endpoint", () => {
    expect(isSiemConfigured({ enabled: true, endpoint: "https://x", format: "json", token: "" })).toBe(true);
    expect(isSiemConfigured({ enabled: false, endpoint: "https://x", format: "json", token: "" })).toBe(false);
    expect(isSiemConfigured({ enabled: true, endpoint: "", format: "json", token: "" })).toBe(false);
  });
});
