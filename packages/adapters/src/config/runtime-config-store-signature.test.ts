import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SIGNATURE_CONFIG,
  SIGNATURE_CONFIG_SETTING_KEY,
  type ISystemSettingsRepository,
} from "@wayfinder/domain";
import { RuntimeConfigStore, type EnvDefaults } from "./runtime-config-store";

const env: EnvDefaults = {
  provider: "anthropic",
  apiKeys: { anthropic: null, openai: null, mistral: null, bedrock: null },
  storage: {
    endpoint: "localhost",
    port: 9000,
    useSSL: false,
    accessKey: "ak",
    secretKey: "sk",
    bucket: "wayfinder-documents",
  },
  embeddingsProvider: "local",
};

const repoWith = (rows: Record<string, string>) => {
  const get = vi.fn(async (key: string) => {
    const value = rows[key];
    return { data: value === undefined ? null : { key, value, createdAt: new Date(), updatedAt: new Date() } };
  });
  return { repo: { get, set: vi.fn(), delete: vi.fn() } as unknown as ISystemSettingsRepository, get, rows };
};

describe("RuntimeConfigStore.getSignatureConfig", () => {
  it("is attestation when never saved", async () => {
    const { repo } = repoWith({});

    expect(await new RuntimeConfigStore(repo, env).getSignatureConfig()).toEqual(DEFAULT_SIGNATURE_CONFIG);
  });

  it("serves the stored config from cache until invalidated", async () => {
    const { repo, get, rows } = repoWith({
      [SIGNATURE_CONFIG_SETTING_KEY]: JSON.stringify({ method: "drawn", gotenbergUrl: "http://g:3000" }),
    });
    const store = new RuntimeConfigStore(repo, env);

    expect((await store.getSignatureConfig()).method).toBe("drawn");
    rows[SIGNATURE_CONFIG_SETTING_KEY] = JSON.stringify({ method: "attestation" });
    expect((await store.getSignatureConfig()).method).toBe("drawn");
    store.invalidateSignature();
    expect((await store.getSignatureConfig()).method).toBe("attestation");
    expect(get).toHaveBeenCalledTimes(2);
  });
});
