import { describe, expect, it } from "vitest";
import type { AiConfig } from "@rbrasier/domain";
import { documentGenerationConfigInputSchema, mergeApiKeys } from "./settings";

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

import { mergeAuthConfig } from "./settings";

const storedAuth = {
  emailPasswordEnabled: true,
  entraEnabled: true,
  entra: { tenantId: "stored-tenant", clientId: "stored-client", clientSecret: "stored-secret" },
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
});
