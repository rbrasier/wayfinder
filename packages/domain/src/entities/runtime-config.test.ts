import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEPLOYMENT_CONFIG,
  DEFAULT_ONBOARDING_STATE,
  DEFAULT_SIEM_CONFIG,
  createDefaultAuthConfig,
  isAtLeastOneMethodEnabled,
  isEntraConfigured,
  isSiemConfigured,
  parseDeploymentConfig,
  parseOnboardingState,
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

describe("parseOnboardingState", () => {
  it("falls back to the not-completed default on malformed JSON", () => {
    expect(parseOnboardingState("{ not json")).toEqual(DEFAULT_ONBOARDING_STATE);
  });

  it("defaults an unconfigured install to not completed", () => {
    expect(DEFAULT_ONBOARDING_STATE).toEqual({ completed: false, completedAt: null });
  });

  it("reads a well-formed completed state", () => {
    const state = parseOnboardingState(
      JSON.stringify({ completed: true, completedAt: "2026-07-20T00:00:00.000Z" }),
    );
    expect(state).toEqual({ completed: true, completedAt: "2026-07-20T00:00:00.000Z" });
  });

  it("keeps completedAt null when it is absent or not a string", () => {
    expect(parseOnboardingState(JSON.stringify({ completed: true })).completedAt).toBeNull();
    expect(parseOnboardingState(JSON.stringify({ completed: true, completedAt: 42 })).completedAt).toBeNull();
  });

  it("treats a non-boolean completed as not completed", () => {
    expect(parseOnboardingState(JSON.stringify({ completed: "yes" })).completed).toBe(false);
  });
});

describe("parseDeploymentConfig", () => {
  it("falls back to single-organisation on malformed JSON", () => {
    expect(parseDeploymentConfig("nope")).toEqual(DEFAULT_DEPLOYMENT_CONFIG);
  });

  it("defaults an unconfigured install to single organisation", () => {
    expect(DEFAULT_DEPLOYMENT_CONFIG).toEqual({ multiOrganisation: false });
  });

  it("reads a well-formed multi-organisation choice", () => {
    expect(parseDeploymentConfig(JSON.stringify({ multiOrganisation: true }))).toEqual({
      multiOrganisation: true,
    });
  });

  it("treats a non-boolean flag as single organisation", () => {
    expect(parseDeploymentConfig(JSON.stringify({ multiOrganisation: 1 })).multiOrganisation).toBe(false);
  });
});
