export interface TtlCacheOptions {
  // How long an entry stays fresh, in milliseconds. A value of 0 disables caching:
  // every read misses, which is the safe default for environments that must never
  // serve a stale auth/permission result.
  readonly ttlMs: number;
  // Hard cap on retained entries. The oldest entry is evicted once this is exceeded,
  // bounding memory under a flood of distinct keys (e.g. many session tokens).
  readonly maxEntries: number;
}

interface CacheEntry<Value> {
  readonly value: Value;
  readonly expiresAt: number;
}

/**
 * In-process, time-bounded cache for hot-path lookups (session + permission
 * resolution on the request path). Correct for a single instance; when more than
 * one instance runs, promote callers to a shared store (Redis) so invalidation is
 * cross-instance — see the scaling-new-infrastructure phase doc. Keys are insertion
 * ordered so eviction removes the least-recently-written entry.
 */
export class TtlCache<Value> {
  private readonly entries = new Map<string, CacheEntry<Value>>();

  constructor(private readonly options: TtlCacheOptions) {}

  get(key: string): Value | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: Value): void {
    // Re-insert so the key moves to the most-recent position for eviction ordering.
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.options.ttlMs });
    if (this.entries.size > this.options.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
