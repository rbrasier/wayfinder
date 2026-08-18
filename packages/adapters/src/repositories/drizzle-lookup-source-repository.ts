import { domainError, err, ok } from "@rbrasier/domain";
import type {
  CachedValueSet,
  ILookupSourceRepository,
  LookupSource,
  NewLookupSource,
  Result,
} from "@rbrasier/domain";
import { asc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { kb_lookup_source_entries, kb_lookup_sources } from "../db/schema/kb";
import { logRepoError } from "./log-repo-error";

export const toLookupSource = (row: typeof kb_lookup_sources.$inferSelect): LookupSource => ({
  id: row.id,
  name: row.name,
  label: row.label,
  kind: row.kind,
  config: row.config ?? {},
  displayField: row.display_field,
  ...(row.key_field ? { keyField: row.key_field } : {}),
  ...(row.credential_ref ? { credentialRef: row.credential_ref } : {}),
  cacheTtlSeconds: row.cache_ttl_seconds,
  enabled: row.enabled,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const toLookupSourceColumns = (source: NewLookupSource) => ({
  name: source.name,
  label: source.label,
  kind: source.kind,
  config: source.config as Record<string, unknown>,
  display_field: source.displayField,
  key_field: source.keyField ?? null,
  credential_ref: source.credentialRef ?? null,
  cache_ttl_seconds: source.cacheTtlSeconds,
  enabled: source.enabled,
});

export const toEntryRows = (sourceId: string, cached: CachedValueSet) =>
  cached.entries.map((entry) => ({
    source_id: sourceId,
    display: entry.display,
    key: entry.key ?? null,
    version: cached.version,
    fetched_at: cached.fetchedAt,
  }));

export const toCachedValueSet = (
  rows: Array<typeof kb_lookup_source_entries.$inferSelect>,
): CachedValueSet | null => {
  const first = rows[0];
  if (!first) return null;

  return {
    entries: rows.map((row) => ({
      display: row.display,
      ...(row.key ? { key: row.key } : {}),
    })),
    version: first.version,
    fetchedAt: first.fetched_at,
  };
};

export class DrizzleLookupSourceRepository implements ILookupSourceRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<Result<LookupSource[]>> {
    try {
      const rows = await this.db
        .select()
        .from(kb_lookup_sources)
        .orderBy(asc(kb_lookup_sources.created_at));
      return ok(rows.map(toLookupSource));
    } catch (cause) {
      return this.failure("list lookup sources", cause);
    }
  }

  async findById(id: string): Promise<Result<LookupSource | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(kb_lookup_sources)
        .where(eq(kb_lookup_sources.id, id))
        .limit(1);
      return ok(row ? toLookupSource(row) : null);
    } catch (cause) {
      return this.failure("read a lookup source", cause);
    }
  }

  async findByName(name: string): Promise<Result<LookupSource | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(kb_lookup_sources)
        .where(eq(kb_lookup_sources.name, name))
        .limit(1);
      return ok(row ? toLookupSource(row) : null);
    } catch (cause) {
      return this.failure("read a lookup source", cause);
    }
  }

  async create(source: NewLookupSource): Promise<Result<LookupSource>> {
    try {
      const [row] = await this.db
        .insert(kb_lookup_sources)
        .values(toLookupSourceColumns(source))
        .returning();
      return ok(toLookupSource(row!));
    } catch (cause) {
      return this.failure("create a lookup source", cause);
    }
  }

  async update(id: string, source: NewLookupSource): Promise<Result<LookupSource>> {
    try {
      const [row] = await this.db
        .update(kb_lookup_sources)
        .set({ ...toLookupSourceColumns(source), updated_at: new Date() })
        .where(eq(kb_lookup_sources.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", `Lookup source "${id}" does not exist.`));
      return ok(toLookupSource(row));
    } catch (cause) {
      return this.failure("update a lookup source", cause);
    }
  }

  async deleteById(id: string): Promise<Result<void>> {
    try {
      await this.db.delete(kb_lookup_sources).where(eq(kb_lookup_sources.id, id));
      return ok(undefined);
    } catch (cause) {
      return this.failure("delete a lookup source", cause);
    }
  }

  async readCachedEntries(sourceId: string): Promise<Result<CachedValueSet | null>> {
    try {
      const rows = await this.db
        .select()
        .from(kb_lookup_source_entries)
        .where(eq(kb_lookup_source_entries.source_id, sourceId))
        .orderBy(asc(kb_lookup_source_entries.display));
      return ok(toCachedValueSet(rows));
    } catch (cause) {
      return this.failure("read cached lookup entries", cause);
    }
  }

  // One active version per source: the replacement is a delete-then-insert in a
  // single transaction, so a reader never sees two versions interleaved.
  async replaceCachedEntries(sourceId: string, cached: CachedValueSet): Promise<Result<void>> {
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .delete(kb_lookup_source_entries)
          .where(eq(kb_lookup_source_entries.source_id, sourceId));
        const rows = toEntryRows(sourceId, cached);
        if (rows.length > 0) await tx.insert(kb_lookup_source_entries).values(rows);
      });
      return ok(undefined);
    } catch (cause) {
      return this.failure("cache lookup entries", cause);
    }
  }

  private failure(action: string, cause: unknown) {
    logRepoError(action, cause);
    return err(domainError("INFRA_FAILURE", `Could not ${action}.`, cause));
  }
}
