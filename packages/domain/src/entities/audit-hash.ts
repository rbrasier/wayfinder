// Tamper-evidence for the audit log (ADR-033). The canonicalisation and chain
// rule are pure here; the SHA-256 primitive is injected so the domain keeps its
// zero-dependency, relative-imports-only constraint — the adapter supplies a
// node:crypto implementation.

export type Sha256Hex = (input: string) => string;

// The subset of an audit row bound into the hash. Explicit so the canonical
// string is stable no matter how the persisted row is shaped.
export interface AuditHashInput {
  readonly actorId: string | null;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: Date;
  readonly sequence: number;
}

// A persisted, already-chained row, as needed to re-verify the chain.
export interface ChainedAuditRow extends AuditHashInput {
  readonly prevHash: string | null;
  readonly hash: string;
}

export type AuditChainBreakReason = "hash_mismatch" | "prev_hash_mismatch";

export interface AuditChainBreak {
  readonly sequence: number;
  readonly reason: AuditChainBreakReason;
  readonly expectedHash: string;
  readonly actualHash: string;
}

const sortDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.keys(source)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = sortDeep(source[key]);
        return accumulator;
      }, {});
  }
  return value;
};

// Deterministic serialisation: top-level fields in a fixed order, metadata keys
// sorted recursively, so two rows with the same content always produce the same
// string. `null` metadata and an empty object serialise differently on purpose.
export const canonicalAuditString = (input: AuditHashInput): string =>
  JSON.stringify({
    sequence: input.sequence,
    actorId: input.actorId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    createdAt: input.createdAt.toISOString(),
    metadata: input.metadata === null ? null : sortDeep(input.metadata),
  });

// The SHA-256 preimage: previous row's hash (empty string for the genesis row)
// concatenated with this row's canonical string.
export const auditHashPreimage = (prevHash: string | null, canonical: string): string =>
  `${prevHash ?? ""}${canonical}`;

export const computeAuditHash = (
  input: AuditHashInput,
  prevHash: string | null,
  sha256Hex: Sha256Hex,
): string => sha256Hex(auditHashPreimage(prevHash, canonicalAuditString(input)));

// Recomputes the chain over rows (sorted by ascending sequence) and returns the
// first break, or null if intact. A rewritten field breaks that row's own hash;
// a deleted or reordered row breaks the next row's prev-hash link.
export const verifyAuditChain = (
  rows: readonly ChainedAuditRow[],
  sha256Hex: Sha256Hex,
): AuditChainBreak | null => {
  const ordered = [...rows].sort((a, b) => a.sequence - b.sequence);
  let previousHash: string | null = null;

  for (const row of ordered) {
    if (row.prevHash !== previousHash) {
      return {
        sequence: row.sequence,
        reason: "prev_hash_mismatch",
        expectedHash: previousHash ?? "",
        actualHash: row.prevHash ?? "",
      };
    }

    const expectedHash = computeAuditHash(row, row.prevHash, sha256Hex);
    if (row.hash !== expectedHash) {
      return {
        sequence: row.sequence,
        reason: "hash_mismatch",
        expectedHash,
        actualHash: row.hash,
      };
    }

    previousHash = row.hash;
  }

  return null;
};
