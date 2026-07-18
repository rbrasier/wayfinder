import type { AuditLog } from "./audit-log";

// Pure export shaping for the admin audit download (ADR-033). Kept in the domain
// so the exact CSV framing and escaping are unit-tested independently of any
// HTTP or DB concern.

const CSV_HEADER = [
  "id",
  "sequence",
  "created_at",
  "actor_id",
  "action",
  "resource_type",
  "resource_id",
  "metadata",
] as const;

const escapeCsvField = (value: string): string => {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
};

const cell = (value: string | null): string => (value === null ? "" : escapeCsvField(value));

export const toAuditCsv = (rows: readonly AuditLog[]): string => {
  const lines = [CSV_HEADER.join(",")];
  for (const row of rows) {
    lines.push(
      [
        cell(row.id),
        cell(String(row.sequence)),
        cell(row.createdAt.toISOString()),
        cell(row.actorId),
        cell(row.action),
        cell(row.resourceType),
        cell(row.resourceId),
        cell(row.metadata === null ? null : JSON.stringify(row.metadata)),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
};

export const toAuditJson = (rows: readonly AuditLog[]): string =>
  JSON.stringify(
    rows.map((row) => ({
      id: row.id,
      sequence: row.sequence,
      createdAt: row.createdAt.toISOString(),
      actorId: row.actorId,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      metadata: row.metadata,
    })),
    null,
    2,
  );
