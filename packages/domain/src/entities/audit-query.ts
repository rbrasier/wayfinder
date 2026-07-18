import { domainError } from "../errors/domain-error";
import { err, ok, type Result } from "../result";

// Value object for the admin audit search (ADR-033). Results are always ordered
// newest-first (createdAt desc, sequence desc as tiebreak), so sort is fixed and
// not part of the query.

export const AUDIT_QUERY_DEFAULT_LIMIT = 50;
export const AUDIT_QUERY_MAX_LIMIT = 500;

export interface AuditQueryFilter {
  readonly actorId?: string;
  readonly action?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  // Inclusive lower/upper bounds on createdAt.
  readonly from?: Date;
  readonly to?: Date;
}

export interface AuditQuery {
  readonly filter: AuditQueryFilter;
  readonly limit: number;
  readonly offset: number;
}

export interface AuditQueryInput {
  readonly actorId?: string | null;
  readonly action?: string | null;
  readonly resourceType?: string | null;
  readonly resourceId?: string | null;
  readonly from?: Date | null;
  readonly to?: Date | null;
  readonly limit?: number;
  readonly offset?: number;
}

const trimmedOrUndefined = (value: string | null | undefined): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const clampLimit = (limit: number | undefined): number => {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return AUDIT_QUERY_DEFAULT_LIMIT;
  return Math.min(AUDIT_QUERY_MAX_LIMIT, Math.max(1, Math.floor(limit)));
};

const clampOffset = (offset: number | undefined): number => {
  if (typeof offset !== "number" || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.floor(offset));
};

export const buildAuditQuery = (input: AuditQueryInput): Result<AuditQuery> => {
  const from = input.from ?? undefined;
  const to = input.to ?? undefined;
  if (from && to && from.getTime() > to.getTime()) {
    return err(domainError("VALIDATION_FAILED", "Audit date range starts after it ends."));
  }

  return ok({
    filter: {
      actorId: trimmedOrUndefined(input.actorId),
      action: trimmedOrUndefined(input.action),
      resourceType: trimmedOrUndefined(input.resourceType),
      resourceId: trimmedOrUndefined(input.resourceId),
      from,
      to,
    },
    limit: clampLimit(input.limit),
    offset: clampOffset(input.offset),
  });
};
