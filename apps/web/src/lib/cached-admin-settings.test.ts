import { describe, expect, it, vi } from "vitest";
import { TtlCache } from "@rbrasier/adapters";
import { createCachedAdminSettings, type AdminSettingsSources } from "./cached-admin-settings";

const uploadConfig = { totalBudgetChars: 1000 } as AdminSettingsSources extends {
  getSessionUploadConfig: () => Promise<infer U>;
}
  ? U
  : never;

const makeSources = (): AdminSettingsSources & {
  orgCalls: number;
  instructionCalls: number;
  uploadCalls: number;
} => {
  const state = { orgCalls: 0, instructionCalls: 0, uploadCalls: 0 };
  return {
    ...state,
    getSystemSetting: vi.fn(async (key: string) => {
      if (key === "organisation_name") {
        state.orgCalls += 1;
        return { value: "Acme" };
      }
      state.instructionCalls += 1;
      return { value: "Be concise" };
    }),
    getSessionUploadConfig: vi.fn(async () => {
      state.uploadCalls += 1;
      return uploadConfig;
    }),
    get orgCalls() {
      return state.orgCalls;
    },
    get instructionCalls() {
      return state.instructionCalls;
    },
    get uploadCalls() {
      return state.uploadCalls;
    },
  };
};

describe("createCachedAdminSettings", () => {
  it("resolves org name, global instructions, and upload config together", async () => {
    const sources = makeSources();
    const settings = createCachedAdminSettings(sources, new TtlCache({ ttlMs: 30_000, maxEntries: 4 }));

    const resolved = await settings.get();

    expect(resolved.organisationName).toBe("Acme");
    expect(resolved.globalInstructions).toBe("Be concise");
    expect(resolved.uploadConfig).toEqual(uploadConfig);
  });

  it("serves a warm cache without re-reading the near-static settings", async () => {
    const sources = makeSources();
    const settings = createCachedAdminSettings(sources, new TtlCache({ ttlMs: 30_000, maxEntries: 4 }));

    await settings.get();
    await settings.get();

    expect(sources.orgCalls).toBe(1);
    expect(sources.instructionCalls).toBe(1);
    expect(sources.uploadCalls).toBe(1);
  });

  it("re-reads once the TTL disables caching (ttl 0)", async () => {
    const sources = makeSources();
    const settings = createCachedAdminSettings(sources, new TtlCache({ ttlMs: 0, maxEntries: 4 }));

    await settings.get();
    await settings.get();

    expect(sources.orgCalls).toBe(2);
  });
});
