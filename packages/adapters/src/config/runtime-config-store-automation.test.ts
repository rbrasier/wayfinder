import { describe, expect, it, vi } from "vitest";
import {
  AUTOMATION_CONFIG_SETTING_KEY,
  DEFAULT_AUTOMATION_CONFIG,
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

describe("RuntimeConfigStore.getAutomationConfig", () => {
  it("allows nothing extra when the setting has never been saved", async () => {
    const { repo } = repoWith({});

    expect(await new RuntimeConfigStore(repo, env).getAutomationConfig()).toEqual(DEFAULT_AUTOMATION_CONFIG);
  });

  it("reads the stored allow-lists and serves them from cache until invalidated", async () => {
    const { repo, get, rows } = repoWith({
      [AUTOMATION_CONFIG_SETTING_KEY]: JSON.stringify({ watchAllowedHosts: ["api.internal"], emailAllowedDomains: [] }),
    });
    const store = new RuntimeConfigStore(repo, env);

    expect((await store.getAutomationConfig()).watchAllowedHosts).toEqual(["api.internal"]);
    rows[AUTOMATION_CONFIG_SETTING_KEY] = JSON.stringify({ watchAllowedHosts: [], emailAllowedDomains: ["agency.gov.au"] });
    await store.getAutomationConfig();
    expect(get).toHaveBeenCalledTimes(1);

    store.invalidateAutomation();

    expect((await store.getAutomationConfig()).emailAllowedDomains).toEqual(["agency.gov.au"]);
  });
});
