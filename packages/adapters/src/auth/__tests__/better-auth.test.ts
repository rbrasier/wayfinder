import { describe, it, expect } from "vitest";
import type { AuthConfig } from "@rbrasier/domain";
import { createDatabase } from "../../db/client";
import { createAuth, microsoftProviderFor, type AuthMethod } from "../better-auth";

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

describe("createAuth id generation", () => {
  // Better Auth defaults to random string ids, but every core_* table declares
  // `id` as a Postgres uuid column. Without this option Postgres rejects the
  // insert: "invalid input syntax for type uuid". Constructing the client with
  // a dummy URL is safe — postgres-js does not connect until a query runs.
  const database = createDatabase("postgres://user:pass@localhost:5432/wayfinder_test");

  const config = {
    secret: "test-secret-value-at-least-32-chars-long",
    baseURL: "http://localhost:3000",
    adminSeedEmail: undefined,
    authMethod: { type: "email-password" } as AuthMethod,
    authConfig: {
      emailPasswordEnabled: true,
      entraEnabled: false,
      entra: { tenantId: "", clientId: "", clientSecret: "" },
    } satisfies AuthConfig,
  };

  it("configures Better Auth to generate uuid ids for the database", () => {
    const auth = createAuth(database, config);

    const options = (
      auth as unknown as {
        options?: { advanced?: { database?: { generateId?: unknown } } };
      }
    ).options;

    expect(options?.advanced?.database?.generateId).toBe("uuid");
  });
});
