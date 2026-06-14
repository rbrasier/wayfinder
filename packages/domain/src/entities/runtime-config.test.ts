import { describe, expect, it } from "vitest";
import {
  createDefaultAuthConfig,
  isAtLeastOneMethodEnabled,
  isEntraConfigured,
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
