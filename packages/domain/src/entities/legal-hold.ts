// Legal hold (ADR-033). A named freeze that overrides retention. Scope is coarse
// in this phase: `global` freezes the whole sweep; `by_session` freezes one
// session's audit and message history. The coverage predicates are pure so the
// retention guard can be tested without a database.

export type LegalHoldScope =
  | { readonly kind: "global" }
  | { readonly kind: "by_session"; readonly sessionId: string };

export interface LegalHold {
  readonly id: string;
  readonly name: string;
  readonly reason: string | null;
  readonly createdBy: string | null;
  readonly scope: LegalHoldScope;
  // Null while the hold is active; set when an operator releases it.
  readonly releasedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewLegalHold {
  readonly name: string;
  readonly reason?: string | null;
  readonly createdBy?: string | null;
  readonly scope: LegalHoldScope;
}

// A retention candidate carries the session it belongs to (messages) or the
// session it references (audit rows on a session resource). Non-session rows
// leave it null and are only ever covered by a global hold.
export interface RetentionCandidate {
  readonly sessionId?: string | null;
}

export const isHoldActive = (hold: LegalHold): boolean => hold.releasedAt === null;

export const activeHolds = (holds: readonly LegalHold[]): LegalHold[] =>
  holds.filter(isHoldActive);

export const hasGlobalHold = (holds: readonly LegalHold[]): boolean =>
  activeHolds(holds).some((hold) => hold.scope.kind === "global");

export const heldSessionIds = (holds: readonly LegalHold[]): string[] => {
  const ids = new Set<string>();
  for (const hold of activeHolds(holds)) {
    if (hold.scope.kind === "by_session") ids.add(hold.scope.sessionId);
  }
  return [...ids];
};

export const isRowCoveredByHold = (
  holds: readonly LegalHold[],
  candidate: RetentionCandidate,
): boolean => {
  if (hasGlobalHold(holds)) return true;
  if (!candidate.sessionId) return false;
  return heldSessionIds(holds).includes(candidate.sessionId);
};
