import { describe, expect, it } from "vitest";
import { sessionPolicyViolations, type AiConfig } from "@rbrasier/domain";
import {
  documentGenerationConfigInputSchema,
  extractionConfigInputSchema,
  mergeApiKeys,
} from "./settings";
import {
  UNAVAILABLE_LOCAL_EMBEDDINGS_REASON,
  embeddingsProviderOptions,
  embeddingsProviderUnavailableReason,
} from "./settings-embeddings";

const stored: AiConfig["apiKeys"] = {
  anthropic: "sk-stored-anthropic",
  openai: null,
  mistral: null,
  bedrock: {
    region: "us-east-1",
    accessKeyId: "AKIA-stored",
    secretAccessKey: "secret-stored",
  },
};

describe("settings router — mergeApiKeys (bedrock)", () => {
  it("keeps the stored bedrock credentials when incoming bedrock is null", () => {
    const merged = mergeApiKeys({ bedrock: null }, stored);

    expect(merged.bedrock).toEqual(stored.bedrock);
  });

  it("keeps the stored bedrock credentials when incoming bedrock is undefined", () => {
    const merged = mergeApiKeys({}, stored);

    expect(merged.bedrock).toEqual(stored.bedrock);
  });

  it("merges per-field: blank fields keep stored values, set fields override", () => {
    const merged = mergeApiKeys(
      {
        bedrock: {
          region: "",
          accessKeyId: "AKIA-rotated",
          secretAccessKey: "",
        },
      },
      stored,
    );

    expect(merged.bedrock).toEqual({
      region: "us-east-1",
      accessKeyId: "AKIA-rotated",
      secretAccessKey: "secret-stored",
    });
  });

  it("replaces all three fields when the client sends a full triplet", () => {
    const merged = mergeApiKeys(
      {
        bedrock: {
          region: "eu-west-1",
          accessKeyId: "AKIA-new",
          secretAccessKey: "secret-new",
        },
      },
      stored,
    );

    expect(merged.bedrock).toEqual({
      region: "eu-west-1",
      accessKeyId: "AKIA-new",
      secretAccessKey: "secret-new",
    });
  });

  it("returns stored credentials unchanged when no field would form a complete triplet", () => {
    const blankStored: AiConfig["apiKeys"] = { ...stored, bedrock: null };
    const merged = mergeApiKeys(
      {
        bedrock: {
          region: "us-east-1",
          accessKeyId: "",
          secretAccessKey: "",
        },
      },
      blankStored,
    );

    expect(merged.bedrock).toBeNull();
  });

  it("does not affect legacy provider keys", () => {
    const merged = mergeApiKeys(
      {
        anthropic: "sk-rotated-anthropic",
        bedrock: null,
      },
      stored,
    );

    expect(merged.anthropic).toBe("sk-rotated-anthropic");
    expect(merged.openai).toBeNull();
    expect(merged.mistral).toBeNull();
    expect(merged.bedrock).toEqual(stored.bedrock);
  });
});

describe("settings router — documentGenerationConfigInputSchema", () => {
  const valid = {
    contextBudgetMode: "tokens" as const,
    contextBudgetTokens: 100_000,
    contextBudgetPercent: 50,
    fieldBatchSize: 12,
    maxPromptTokens: 180_000,
  };

  it("accepts a valid configuration", () => {
    expect(documentGenerationConfigInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a zero field batch size", () => {
    expect(
      documentGenerationConfigInputSchema.safeParse({ ...valid, fieldBatchSize: 0 }).success,
    ).toBe(false);
  });

  it("rejects a context budget percent outside 1–100", () => {
    expect(
      documentGenerationConfigInputSchema.safeParse({ ...valid, contextBudgetPercent: 0 }).success,
    ).toBe(false);
    expect(
      documentGenerationConfigInputSchema.safeParse({ ...valid, contextBudgetPercent: 101 }).success,
    ).toBe(false);
  });

  it("rejects a non-positive context budget token cap", () => {
    expect(
      documentGenerationConfigInputSchema.safeParse({ ...valid, contextBudgetTokens: -1 }).success,
    ).toBe(false);
  });

  it("rejects an unknown budget mode", () => {
    expect(
      documentGenerationConfigInputSchema.safeParse({ ...valid, contextBudgetMode: "bananas" })
        .success,
    ).toBe(false);
  });
});

describe("settings router — extractionConfigInputSchema", () => {
  const valid = {
    maxFilesPerRun: 1000,
    maxArchiveEntries: 500,
    maxArchiveEntryBytes: 25 * 1024 * 1024,
    maxArchiveTotalBytes: 500 * 1024 * 1024,
    perRunCostCeilingUsd: 0,
  };

  it("accepts a valid configuration", () => {
    expect(extractionConfigInputSchema.safeParse(valid).success).toBe(true);
  });

  it("allows a zero cost ceiling (no ceiling) but rejects a negative one", () => {
    expect(extractionConfigInputSchema.safeParse({ ...valid, perRunCostCeilingUsd: 0 }).success).toBe(
      true,
    );
    expect(
      extractionConfigInputSchema.safeParse({ ...valid, perRunCostCeilingUsd: -1 }).success,
    ).toBe(false);
  });

  it("rejects a non-positive file or entry cap", () => {
    expect(extractionConfigInputSchema.safeParse({ ...valid, maxFilesPerRun: 0 }).success).toBe(
      false,
    );
    expect(extractionConfigInputSchema.safeParse({ ...valid, maxArchiveEntries: -5 }).success).toBe(
      false,
    );
  });
});

import { mergeAuthConfig, sessionPolicyInputSchema } from "./settings-auth";

const storedAuth = {
  emailPasswordEnabled: true,
  entraEnabled: true,
  entra: { tenantId: "stored-tenant", clientId: "stored-client", clientSecret: "stored-secret" },
  pkiEnabled: true,
  pki: { sessionTtlHours: 12 },
  sessionPolicy: {
    idleTimeoutMinutes: 30,
    absoluteTimeoutMinutes: 480,
    concurrentSessionLimit: 3,
    evictionStrategy: "evict_oldest" as const,
  },
};

describe("settings router — mergeAuthConfig", () => {
  it("keeps the stored secret when the incoming secret is blank", () => {
    const merged = mergeAuthConfig(
      {
        emailPasswordEnabled: false,
        entraEnabled: true,
        entra: { tenantId: "new-tenant", clientId: "new-client", clientSecret: "" },
      },
      storedAuth,
    );

    expect(merged.entra.clientSecret).toBe("stored-secret");
    expect(merged.entra.tenantId).toBe("new-tenant");
    expect(merged.emailPasswordEnabled).toBe(false);
  });

  it("replaces the stored secret when a new secret is provided", () => {
    const merged = mergeAuthConfig(
      {
        emailPasswordEnabled: true,
        entraEnabled: true,
        entra: { tenantId: "t", clientId: "c", clientSecret: "rotated-secret" },
      },
      storedAuth,
    );

    expect(merged.entra.clientSecret).toBe("rotated-secret");
  });

  it("treats an omitted secret the same as a blank one", () => {
    const merged = mergeAuthConfig(
      {
        emailPasswordEnabled: true,
        entraEnabled: false,
        entra: { tenantId: "t", clientId: "c" },
      },
      storedAuth,
    );

    expect(merged.entra.clientSecret).toBe("stored-secret");
  });

  it("applies an incoming PKI switch and TTL", () => {
    const merged = mergeAuthConfig(
      {
        emailPasswordEnabled: true,
        entraEnabled: false,
        entra: { tenantId: "t", clientId: "c" },
        pkiEnabled: false,
        pki: { sessionTtlHours: 4 },
      },
      storedAuth,
    );

    expect(merged.pkiEnabled).toBe(false);
    expect(merged.pki.sessionTtlHours).toBe(4);
  });

  // An older client that knows nothing about PKI must not silently switch it
  // off just by saving the Entra half of the form.
  it("keeps the stored PKI settings when the client omits them", () => {
    const merged = mergeAuthConfig(
      {
        emailPasswordEnabled: true,
        entraEnabled: false,
        entra: { tenantId: "t", clientId: "c" },
      },
      storedAuth,
    );

    expect(merged.pkiEnabled).toBe(true);
    expect(merged.pki.sessionTtlHours).toBe(12);
  });
});

import { directoryConfigInputSchema, mergeDirectoryConfig } from "./settings-directory";

const storedDirectory = {
  enabled: true,
  credentialSource: "own" as const,
  entra: { tenantId: "stored-tenant", clientId: "stored-client", clientSecret: "stored-secret" },
};

describe("settings router — mergeDirectoryConfig", () => {
  it("keeps the stored secret when the incoming secret is blank", () => {
    const merged = mergeDirectoryConfig(
      {
        enabled: true,
        credentialSource: "own",
        entra: { tenantId: "new-tenant", clientId: "new-client", clientSecret: "" },
      },
      storedDirectory,
    );

    expect(merged.entra.clientSecret).toBe("stored-secret");
    expect(merged.entra.tenantId).toBe("new-tenant");
  });

  it("treats an omitted secret the same as a blank one", () => {
    const merged = mergeDirectoryConfig(
      { enabled: true, credentialSource: "own", entra: { tenantId: "t", clientId: "c" } },
      storedDirectory,
    );

    expect(merged.entra.clientSecret).toBe("stored-secret");
  });

  it("replaces the stored secret when a new one is provided", () => {
    const merged = mergeDirectoryConfig(
      {
        enabled: true,
        credentialSource: "own",
        entra: { tenantId: "t", clientId: "c", clientSecret: "rotated-secret" },
      },
      storedDirectory,
    );

    expect(merged.entra.clientSecret).toBe("rotated-secret");
  });

  it("applies the incoming switch and credential source", () => {
    const merged = mergeDirectoryConfig(
      { enabled: false, credentialSource: "email", entra: { tenantId: "", clientId: "" } },
      storedDirectory,
    );

    expect(merged.enabled).toBe(false);
    expect(merged.credentialSource).toBe("email");
  });

  // Switching to an inherited source must not throw the separate credentials
  // away: an admin who switches back should find them still there.
  it("keeps the separate credentials when the source moves to an inherited one", () => {
    const merged = mergeDirectoryConfig(
      { enabled: true, credentialSource: "auth", entra: { tenantId: "", clientId: "" } },
      storedDirectory,
    );

    expect(merged.entra).toEqual(storedDirectory.entra);
  });
});

describe("settings router — directoryConfigInputSchema", () => {
  it("accepts each of the three credential sources", () => {
    for (const credentialSource of ["email", "auth", "own"]) {
      const parsed = directoryConfigInputSchema.safeParse({
        enabled: true,
        credentialSource,
        entra: { tenantId: "t", clientId: "c" },
      });

      expect(parsed.success, credentialSource).toBe(true);
    }
  });

  it("rejects a credential source it does not know", () => {
    const parsed = directoryConfigInputSchema.safeParse({
      enabled: true,
      credentialSource: "ldap",
      entra: { tenantId: "t", clientId: "c" },
    });

    expect(parsed.success).toBe(false);
  });

  it("defaults blank credentials so a form with an inherited source still validates", () => {
    const parsed = directoryConfigInputSchema.safeParse({
      enabled: true,
      credentialSource: "email",
      entra: {},
    });

    expect(parsed.success).toBe(true);
  });

  it("carries no base URL or authority, which stay in the environment", () => {
    const parsed = directoryConfigInputSchema.parse({
      enabled: true,
      credentialSource: "own",
      entra: { tenantId: "t", clientId: "c", clientSecret: "s" },
      baseUrl: "https://attacker.example",
      authority: "https://attacker.example",
    });

    expect(parsed).not.toHaveProperty("baseUrl");
    expect(parsed).not.toHaveProperty("authority");
  });
});

describe("settings router — session policy", () => {
  // The auth card and the session-policy card share one stored row, so saving
  // either must leave the other's fields exactly as they were.
  it("carries the stored session policy through an auth-methods save", () => {
    const merged = mergeAuthConfig(
      {
        emailPasswordEnabled: true,
        entraEnabled: false,
        entra: { tenantId: "t", clientId: "c" },
      },
      storedAuth,
    );

    expect(merged.sessionPolicy).toEqual(storedAuth.sessionPolicy);
  });

  it("accepts a policy with everything switched off", () => {
    const parsed = sessionPolicyInputSchema.safeParse({
      idleTimeoutMinutes: 0,
      absoluteTimeoutMinutes: 0,
      concurrentSessionLimit: 0,
      evictionStrategy: "evict_oldest",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects a negative timeout, a fractional one and an unknown strategy", () => {
    const negative = sessionPolicyInputSchema.safeParse({
      idleTimeoutMinutes: -1,
      absoluteTimeoutMinutes: 0,
      concurrentSessionLimit: 0,
      evictionStrategy: "evict_oldest",
    });
    const fractional = sessionPolicyInputSchema.safeParse({
      idleTimeoutMinutes: 1.5,
      absoluteTimeoutMinutes: 0,
      concurrentSessionLimit: 0,
      evictionStrategy: "evict_oldest",
    });
    const unknownStrategy = sessionPolicyInputSchema.safeParse({
      idleTimeoutMinutes: 0,
      absoluteTimeoutMinutes: 0,
      concurrentSessionLimit: 0,
      evictionStrategy: "delete_everything",
    });

    expect(negative.success).toBe(false);
    expect(fractional.success).toBe(false);
    expect(unknownStrategy.success).toBe(false);
  });

  // The schema cannot express this one: it is a relationship between two fields,
  // and it is what stops a policy that expires sessions before they can idle.
  it("leaves absolute-below-idle to the domain guard the router calls", () => {
    const parsed = sessionPolicyInputSchema.parse({
      idleTimeoutMinutes: 120,
      absoluteTimeoutMinutes: 60,
      concurrentSessionLimit: 0,
      evictionStrategy: "evict_oldest",
    });

    expect(sessionPolicyViolations(parsed)).toEqual([
      "The absolute timeout must be at least as long as the idle timeout.",
    ]);
  });
});

describe("settings router — embeddings provider availability", () => {
  it("offers both providers when the local runtime is present", () => {
    const options = embeddingsProviderOptions(true);

    expect(options).toEqual([
      { provider: "local", available: true, unavailableReason: null },
      { provider: "openai", available: true, unavailableReason: null },
    ]);
  });

  it("marks local unavailable, with a reason, when the runtime was never packaged", () => {
    const options = embeddingsProviderOptions(false);

    expect(options).toContainEqual({
      provider: "local",
      available: false,
      unavailableReason: UNAVAILABLE_LOCAL_EMBEDDINGS_REASON,
    });
  });

  it("never marks a hosted provider unavailable on account of the local runtime", () => {
    const options = embeddingsProviderOptions(false);

    expect(options).toContainEqual({ provider: "openai", available: true, unavailableReason: null });
  });

  it("gives no reason to reject a provider that can be loaded", () => {
    expect(embeddingsProviderUnavailableReason("local", true)).toBeNull();
    expect(embeddingsProviderUnavailableReason("openai", false)).toBeNull();
  });

  it("gives a reason to reject local when the runtime is absent", () => {
    expect(embeddingsProviderUnavailableReason("local", false)).toBe(
      UNAVAILABLE_LOCAL_EMBEDDINGS_REASON,
    );
  });
});
