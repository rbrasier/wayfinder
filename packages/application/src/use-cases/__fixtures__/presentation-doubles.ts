/**
 * In-memory settings, object storage and audit doubles shared by the branding
 * and sign-in notice use-case specs.
 */

import {
  domainError,
  err,
  ok,
  type AuditLog,
  type AuditPage,
  type AuditQuery,
  type ChainedAuditRow,
  type IAuditLogger,
  type IAuditQueryRepository,
  type IObjectStorage,
  type ISystemSettingsRepository,
  type NewAuditLog,
  type Result,
  type SystemSetting,
} from "@rbrasier/domain";

export class InMemorySystemSettings implements ISystemSettingsRepository {
  readonly values = new Map<string, string>();
  failReads = false;
  failWrites = false;

  async get(key: string): Promise<Result<SystemSetting | null>> {
    if (this.failReads) return err(domainError("INFRA_FAILURE", "Settings table is away."));
    const value = this.values.get(key);
    if (value === undefined) return ok(null);
    const stamp = new Date("2026-09-23T09:00:00Z");
    return ok({ key, value, createdAt: stamp, updatedAt: stamp });
  }

  async set(key: string, value: string): Promise<Result<SystemSetting>> {
    if (this.failWrites) return err(domainError("INFRA_FAILURE", "Settings table is away."));
    this.values.set(key, value);
    const stamp = new Date("2026-09-23T09:00:00Z");
    return ok({ key, value, createdAt: stamp, updatedAt: stamp });
  }

  async delete(key: string): Promise<Result<void>> {
    this.values.delete(key);
    return ok(undefined);
  }
}

export class InMemoryObjectStorage implements IObjectStorage {
  readonly objects = new Map<string, { data: Buffer; mimeType: string }>();
  failPuts = false;
  failDeletes = false;

  async put(key: string, data: Buffer, mimeType: string): Promise<Result<{ key: string }>> {
    if (this.failPuts) return err(domainError("INFRA_FAILURE", "Bucket is away."));
    this.objects.set(key, { data, mimeType });
    return ok({ key });
  }

  async get(key: string): Promise<Result<Buffer>> {
    const stored = this.objects.get(key);
    if (!stored) return err(domainError("NOT_FOUND", `No object at ${key}.`));
    return ok(stored.data);
  }

  async delete(key: string): Promise<Result<void>> {
    if (this.failDeletes) return err(domainError("INFRA_FAILURE", "Bucket is away."));
    this.objects.delete(key);
    return ok(undefined);
  }

  async exists(key: string): Promise<Result<boolean>> {
    return ok(this.objects.has(key));
  }

  async initialise(): Promise<void> {}
}

// Writes and reads the same list, so an acknowledgement written through the
// logger is what the status query finds — the way the real audit table behaves.
export class InMemoryAuditLog implements IAuditLogger, IAuditQueryRepository {
  readonly rows: AuditLog[] = [];
  readonly searches: AuditQuery[] = [];
  failWrites = false;
  failSearches = false;

  async log(payload: NewAuditLog): Promise<Result<true>> {
    if (this.failWrites) return err(domainError("INFRA_FAILURE", "Audit table is away."));
    const sequence = this.rows.length + 1;
    this.rows.push({
      id: `audit-${sequence}`,
      actorId: payload.actorId ?? null,
      action: payload.action,
      resourceType: payload.resourceType,
      resourceId: payload.resourceId ?? null,
      metadata: payload.metadata ?? null,
      createdAt: new Date(Date.UTC(2026, 8, 23, 9, 0, sequence)),
      sequence,
      prevHash: null,
      hash: `hash-${sequence}`,
    });
    return ok(true);
  }

  async search(query: AuditQuery): Promise<Result<AuditPage>> {
    this.searches.push(query);
    if (this.failSearches) return err(domainError("INFRA_FAILURE", "Audit table is away."));
    const matching = this.rows
      .filter((row) => !query.filter.actorId || row.actorId === query.filter.actorId)
      .filter((row) => !query.filter.action || row.action === query.filter.action)
      .filter((row) => !query.filter.resourceId || row.resourceId === query.filter.resourceId)
      .sort((first, second) => second.sequence - first.sequence);
    return ok({
      rows: matching.slice(query.offset, query.offset + query.limit),
      total: matching.length,
      limit: query.limit,
      offset: query.offset,
    });
  }

  async getById(id: string): Promise<Result<AuditLog | null>> {
    return ok(this.rows.find((row) => row.id === id) ?? null);
  }

  async exportRows(): Promise<Result<AuditLog[]>> {
    return ok(this.rows);
  }

  async loadChain(): Promise<Result<ChainedAuditRow[]>> {
    return ok([]);
  }
}

export const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
export const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
