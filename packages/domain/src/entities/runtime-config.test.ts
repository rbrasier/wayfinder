import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEPLOYMENT_CONFIG,
  DEFAULT_ONBOARDING_STATE,
  DEFAULT_PKI_SESSION_TTL_HOURS,
  DEFAULT_SIEM_CONFIG,
  createDefaultAuthConfig,
  createDefaultDirectoryConfig,
  createDefaultEmailConfig,
  isAtLeastOneMethodEnabled,
  isEntraConfigured,
  isPkiUsable,
  isSelfServicePasswordResetAvailable,
  isSiemConfigured,
  parseDeploymentConfig,
  parseOnboardingState,
  parseSiemConfig,
  resolveDirectoryCredentials,
  type AuthConfig,
  type DirectoryConfig,
  type EntraCredentials,
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

  it("disables PKI by default, with a session TTL already set", () => {
    const config = createDefaultAuthConfig();

    expect(config.pkiEnabled).toBe(false);
    expect(config.pki.sessionTtlHours).toBe(DEFAULT_PKI_SESSION_TTL_HOURS);
  });
});

describe("isSelfServicePasswordResetAvailable", () => {
  const config = (emailPasswordEnabled: boolean): AuthConfig => ({
    ...createDefaultAuthConfig(),
    emailPasswordEnabled,
  });

  it("is true only when password sign-in is on and email can actually be sent", () => {
    expect(isSelfServicePasswordResetAvailable(config(true), true)).toBe(true);
  });

  // Without a transport the reset link has no way to reach the user, so the
  // entry point must stay hidden rather than accept an address and do nothing.
  it("is false when password sign-in is on but no email transport is configured", () => {
    expect(isSelfServicePasswordResetAvailable(config(true), false)).toBe(false);
  });

  // Resetting a password nobody can sign in with would hand back a useless
  // credential on an Entra- or certificate-only install.
  it("is false when email is configured but password sign-in is off", () => {
    expect(isSelfServicePasswordResetAvailable(config(false), true)).toBe(false);
  });

  it("is false when neither is available", () => {
    expect(isSelfServicePasswordResetAvailable(config(false), false)).toBe(false);
  });
});

describe("isPkiUsable", () => {
  const config = (pkiEnabled: boolean): AuthConfig => ({
    ...createDefaultAuthConfig(),
    pkiEnabled,
  });

  it("is true only when the switch is on and the environment gate is satisfied", () => {
    expect(isPkiUsable(config(true), true)).toBe(true);
  });

  it("is false when the switch is on but the environment gate is not satisfied", () => {
    expect(isPkiUsable(config(true), false)).toBe(false);
  });

  it("is false when the environment gate is satisfied but the switch is off", () => {
    expect(isPkiUsable(config(false), true)).toBe(false);
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
  const pkiOff = { pkiEnabled: false, pki: { sessionTtlHours: 8 } };

  it("is true when only email/password is enabled", () => {
    const config: AuthConfig = {
      emailPasswordEnabled: true,
      entraEnabled: false,
      entra: blankEntra,
      ...pkiOff,
    };

    expect(isAtLeastOneMethodEnabled(config, false)).toBe(true);
  });

  it("is true when only Entra is enabled", () => {
    const config: AuthConfig = {
      emailPasswordEnabled: false,
      entraEnabled: true,
      entra: blankEntra,
      ...pkiOff,
    };

    expect(isAtLeastOneMethodEnabled(config, false)).toBe(true);
  });

  it("is false when both methods are disabled", () => {
    const config: AuthConfig = {
      emailPasswordEnabled: false,
      entraEnabled: false,
      entra: blankEntra,
      ...pkiOff,
    };

    expect(isAtLeastOneMethodEnabled(config, false)).toBe(false);
  });

  it("counts PKI as the sole method when its environment gate is satisfied", () => {
    const config: AuthConfig = {
      emailPasswordEnabled: false,
      entraEnabled: false,
      entra: blankEntra,
      pkiEnabled: true,
      pki: { sessionTtlHours: 8 },
    };

    expect(isAtLeastOneMethodEnabled(config, true)).toBe(true);
  });

  // The lockout this guard exists to prevent: an admin leaves PKI as the only
  // method, then a later deploy ships without PKI_TRUSTED_PROXY_IPS.
  it("does not count an enabled PKI whose environment gate is unsatisfied", () => {
    const config: AuthConfig = {
      emailPasswordEnabled: false,
      entraEnabled: false,
      entra: blankEntra,
      pkiEnabled: true,
      pki: { sessionTtlHours: 8 },
    };

    expect(isAtLeastOneMethodEnabled(config, false)).toBe(false);
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

describe("createDefaultDirectoryConfig", () => {
  it("starts disabled, inheriting the email app registration", () => {
    const config = createDefaultDirectoryConfig();

    expect(config.enabled).toBe(false);
    expect(config.credentialSource).toBe("email");
  });

  it("starts with blank separate credentials", () => {
    expect(createDefaultDirectoryConfig().entra).toEqual({
      tenantId: "",
      clientId: "",
      clientSecret: "",
    });
  });
});

describe("resolveDirectoryCredentials", () => {
  const emailCredentials: EntraCredentials = {
    tenantId: "email-tenant",
    clientId: "email-client",
    clientSecret: "email-secret",
  };
  const authCredentials: EntraCredentials = {
    tenantId: "auth-tenant",
    clientId: "auth-client",
    clientSecret: "auth-secret",
  };
  const ownCredentials: EntraCredentials = {
    tenantId: "own-tenant",
    clientId: "own-client",
    clientSecret: "own-secret",
  };
  const sources = { email: emailCredentials, auth: authCredentials };

  const config = (overrides: Partial<DirectoryConfig> = {}): DirectoryConfig => ({
    ...createDefaultDirectoryConfig(),
    enabled: true,
    ...overrides,
  });

  it("takes the email app registration when the source is email", () => {
    expect(resolveDirectoryCredentials(config({ credentialSource: "email" }), sources)).toEqual(
      emailCredentials,
    );
  });

  it("takes the sign-in app registration when the source is auth", () => {
    expect(resolveDirectoryCredentials(config({ credentialSource: "auth" }), sources)).toEqual(
      authCredentials,
    );
  });

  it("takes its own credentials when the source is own", () => {
    const own = config({ credentialSource: "own", entra: ownCredentials });

    expect(resolveDirectoryCredentials(own, sources)).toEqual(ownCredentials);
  });

  it("resolves to nothing while the directory is switched off", () => {
    expect(resolveDirectoryCredentials(config({ enabled: false }), sources)).toBeNull();
  });

  it("resolves to nothing when the inherited source is incomplete", () => {
    const incomplete = { email: { tenantId: "t", clientId: "", clientSecret: "" }, auth: authCredentials };

    expect(resolveDirectoryCredentials(config({ credentialSource: "email" }), incomplete)).toBeNull();
  });

  it("resolves to nothing when its own credentials are incomplete", () => {
    const own = config({
      credentialSource: "own",
      entra: { tenantId: "own-tenant", clientId: "own-client", clientSecret: "" },
    });

    expect(resolveDirectoryCredentials(own, sources)).toBeNull();
  });

  it("never falls back to another source when the chosen one is empty", () => {
    const own = config({ credentialSource: "own" });

    expect(resolveDirectoryCredentials(own, sources)).toBeNull();
  });
});

describe("createDefaultEmailConfig", () => {
  it("defaults to SMTP on the submission port with nothing filled in", () => {
    const config = createDefaultEmailConfig();

    expect(config.provider).toBe("smtp");
    expect(config.port).toBe(587);
    expect(config.fromAddress).toBe("");
  });

  it("starts with blank Microsoft 365 credentials", () => {
    const config = createDefaultEmailConfig();

    expect(config.m365TenantId).toBe("");
    expect(config.m365ClientId).toBe("");
    expect(config.m365ClientSecret).toBe("");
  });
});
