import type { ISystemSettingsRepository } from "@rbrasier/domain";

// One admin_system_settings row held in memory until invalidated, with a single
// shared read for concurrent callers. The same cache-and-pending shape the older
// getters in RuntimeConfigStore spell out by hand, kept here so the store stays
// under the source-size ceiling as settings are added.
//
// Unlike those getters, a failed read is served from the fallback but not
// cached: the row is read on every page render, so a blip at startup must not
// pin the defaults for the life of the process.
export class CachedSetting<T> {
  private cache: T | null = null;
  private pending: Promise<T> | null = null;

  constructor(
    private readonly settingsRepo: ISystemSettingsRepository,
    private readonly key: string,
    private readonly parse: (raw: string, fallback: T) => T,
    private readonly createFallback: () => T,
  ) {}

  async get(): Promise<T> {
    if (this.cache !== null) return this.cache;
    if (this.pending) return this.pending;
    this.pending = this.load();
    return this.pending;
  }

  invalidate(): void {
    this.cache = null;
    this.pending = null;
  }

  private async load(): Promise<T> {
    const fallback = this.createFallback();
    const result = await this.settingsRepo.get(this.key);
    this.pending = null;
    if (result.error) return fallback;
    const value = result.data?.value ? this.parse(result.data.value, fallback) : fallback;
    this.cache = value;
    return value;
  }
}
