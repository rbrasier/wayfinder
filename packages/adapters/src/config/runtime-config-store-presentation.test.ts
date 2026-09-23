import { describe, expect, it, vi } from "vitest";
import {
  BRANDING_CONFIG_SETTING_KEY,
  LOGIN_NOTICE_CONFIG_SETTING_KEY,
  createDefaultBrandingConfig,
  createDefaultLoginNoticeConfig,
  type ISystemSettingsRepository,
} from "@rbrasier/domain";
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
  const repo = { get, set: vi.fn(), delete: vi.fn() } as unknown as ISystemSettingsRepository;
  return { repo, get, rows };
};

describe("RuntimeConfigStore.getBrandingConfig", () => {
  it("returns the Wayfinder defaults when nothing is configured", async () => {
    const { repo } = repoWith({});

    expect(await new RuntimeConfigStore(repo, env).getBrandingConfig()).toEqual(
      createDefaultBrandingConfig(),
    );
  });

  it("reads the stored branding row", async () => {
    const { repo } = repoWith({
      [BRANDING_CONFIG_SETTING_KEY]: JSON.stringify({ displayName: "Acme", primaryColour: "#0f766e" }),
    });

    const config = await new RuntimeConfigStore(repo, env).getBrandingConfig();

    expect(config.displayName).toBe("Acme");
    expect(config.primaryColour).toBe("#0f766e");
  });

  it("serves later calls from memory until invalidateBranding", async () => {
    const { repo, get, rows } = repoWith({
      [BRANDING_CONFIG_SETTING_KEY]: JSON.stringify({ displayName: "Acme" }),
    });
    const store = new RuntimeConfigStore(repo, env);
    await store.getBrandingConfig();
    await store.getBrandingConfig();
    expect(get).toHaveBeenCalledTimes(1);

    rows[BRANDING_CONFIG_SETTING_KEY] = JSON.stringify({ displayName: "Acme Ltd" });
    store.invalidateBranding();

    expect((await store.getBrandingConfig()).displayName).toBe("Acme Ltd");
  });
});

describe("RuntimeConfigStore.getLoginNoticeConfig", () => {
  it("is off when nothing is configured", async () => {
    const { repo } = repoWith({});

    expect(await new RuntimeConfigStore(repo, env).getLoginNoticeConfig()).toEqual(
      createDefaultLoginNoticeConfig(),
    );
  });

  it("re-reads after invalidateLoginNotice", async () => {
    const { repo, rows } = repoWith({
      [LOGIN_NOTICE_CONFIG_SETTING_KEY]: JSON.stringify({ mode: "once", text: "Hello", version: 1 }),
    });
    const store = new RuntimeConfigStore(repo, env);
    await store.getLoginNoticeConfig();

    rows[LOGIN_NOTICE_CONFIG_SETTING_KEY] = JSON.stringify({ mode: "off", text: "Hello", version: 1 });
    store.invalidateLoginNotice();

    expect((await store.getLoginNoticeConfig()).mode).toBe("off");
  });
});
