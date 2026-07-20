import type { SessionUploadConfig } from "@rbrasier/domain";
import type { TtlCache } from "@rbrasier/adapters";

// The near-static admin settings the chat stream route reads on every turn. They
// change only when an admin edits them, so a short TTL removes three DB/config
// reads from the hot path (scaling wall #4) while bounding staleness to seconds.
export interface ResolvedAdminSettings {
  organisationName: string | null;
  // Whether the organisations feature is on. When on, a member's chat prompt
  // resolves to their own organisation's name instead of this global one.
  organisationsEnabled: boolean;
  globalInstructions: string | null;
  uploadConfig: SessionUploadConfig;
}

export interface AdminSettingsSources {
  // Returns the setting row (or null) — errors are folded to null by the caller
  // so a settings read never blocks a turn.
  getSystemSetting(key: string): Promise<{ value: string | null } | null>;
  getSessionUploadConfig(): Promise<SessionUploadConfig>;
}

export interface CachedAdminSettings {
  get(): Promise<ResolvedAdminSettings>;
}

const CACHE_KEY = "admin-settings";

export const createCachedAdminSettings = (
  sources: AdminSettingsSources,
  cache: TtlCache<ResolvedAdminSettings>,
): CachedAdminSettings => {
  const load = async (): Promise<ResolvedAdminSettings> => {
    const [organisation, organisationsEnabled, globalPrompt, uploadConfig] = await Promise.all([
      sources.getSystemSetting("organisation_name"),
      sources.getSystemSetting("organisations_enabled"),
      sources.getSystemSetting("global_prompt"),
      sources.getSessionUploadConfig(),
    ]);
    return {
      organisationName: organisation?.value ?? null,
      organisationsEnabled: organisationsEnabled?.value === "true",
      globalInstructions: globalPrompt?.value ?? null,
      uploadConfig,
    };
  };

  return {
    async get() {
      const cached = cache.get(CACHE_KEY);
      if (cached) return cached;
      const resolved = await load();
      cache.set(CACHE_KEY, resolved);
      return resolved;
    },
  };
};
