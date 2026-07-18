// Append-only, tamper-evident audit record (ADR-033). `core_audit_log` is the
// one table that omits `updated_at`: a row is written once and never updated, so
// the entity carries no `updatedAt`. The chain fields are computed at write time.

export interface AuditLog {
  readonly id: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: Date;
  readonly sequence: number;
  // Null only for the genesis row; every later row links to its predecessor.
  readonly prevHash: string | null;
  readonly hash: string;
}

export interface NewAuditLog {
  readonly actorId?: string | null;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string | null;
  readonly metadata?: Record<string, unknown> | null;
}
