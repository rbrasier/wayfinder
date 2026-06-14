import { describe, it, expect } from "vitest";
import type { AuthConfig } from "@rbrasier/domain";
import { microsoftProviderFor, type AuthMethod } from "../better-auth";

describe("AuthMethod discriminated union", () => {
  it("accepts email-password as the default mechanism", () => {
    const method: AuthMethod = { type: "email-password" };
    expect(method.type).toBe("email-password");
  });

  it("accepts pki with config", () => {
    const method: AuthMethod = {
      type: "pki",
      pkiConfig: { trustedProxyIps: ["10.0.0.1"], sessionTtlHours: 8 },
    };
    expect(method.type).toBe("pki");
  });

  it("accepts pki-and-email-password as a combined mode", () => {
    const method: AuthMethod = {
      type: "pki-and-email-password",
      pkiConfig: { trustedProxyIps: ["10.0.0.1"], sessionTtlHours: 8 },
    };
    expect(method.type).toBe("pki-and-email-password");
  });

  it("accepts google-oauth and other", () => {
    const a: AuthMethod = { type: "google-oauth" };
    const b: AuthMethod = { type: "other" };
    expect(a.type).toBe("google-oauth");
    expect(b.type).toBe("other");
  });
});

describe("microsoftProviderFor", () => {
  const fullEntra = { tenantId: "tenant", clientId: "client", clientSecret: "secret" };

  it("returns null when Entra is disabled even if credentials are present", () => {
    const config: AuthConfig = {
      emailPasswordEnabled: true,
      entraEnabled: false,
      entra: fullEntra,
    };

    expect(microsoftProviderFor(config)).toBeNull();
  });

  it("returns the Microsoft provider options when Entra is enabled and configured", () => {
    const config: AuthConfig = {
      emailPasswordEnabled: false,
      entraEnabled: true,
      entra: fullEntra,
    };

    expect(microsoftProviderFor(config)).toEqual({
      clientId: "client",
      clientSecret: "secret",
      tenantId: "tenant",
    });
  });

  it("returns the provider when both methods are enabled", () => {
    const config: AuthConfig = {
      emailPasswordEnabled: true,
      entraEnabled: true,
      entra: fullEntra,
    };

    expect(microsoftProviderFor(config)).not.toBeNull();
  });

  it("returns null when Entra is enabled but credentials are blank (fail closed)", () => {
    const config: AuthConfig = {
      emailPasswordEnabled: true,
      entraEnabled: true,
      entra: { tenantId: "tenant", clientId: "", clientSecret: "" },
    };

    expect(microsoftProviderFor(config)).toBeNull();
  });
});
