import {
  hasGlobalHold,
  heldSessionIds,
  ok,
  type ILegalHoldRepository,
  type ISessionRepository,
  type Result,
} from "@wayfinder/domain";

// Test runs are disposable, but they occupy the same tables as live ones, so a
// heavy tester adds rows to app_session_messages and app_session_step_outputs
// indefinitely. Thirty days is long enough that a fixture-driven regression
// check still has its previous run to compare against.
export const DEFAULT_TEST_SESSION_RETENTION_DAYS = 30;

// Bounded per tick for the same reason the retention sweep is: one pass must
// never turn into an unbounded table rewrite.
export const DEFAULT_SWEEP_BATCH_SIZE = 100;

export interface SweepTestSessionsInput {
  now?: Date;
  retentionDays?: number;
  batchSize?: number;
}

export interface SweepTestSessionsResult {
  deleted: number;
  // True when the batch cap was reached with rows still eligible, so the next
  // tick has more to do.
  more: boolean;
}

// Deliberately its own use-case rather than a RETENTION_TARGETS entry: that
// registry is keyed by table with a whole-table timestamp policy and cannot
// express "rows where mode = 'test'". It still honours the two guards that
// registry provides — by-session legal holds and a per-batch cap — because
// bypassing those is what makes a bespoke sweep dangerous (ADR-048 §6).
export class SweepTestSessions {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly legalHolds: ILegalHoldRepository,
  ) {}

  async execute(input: SweepTestSessionsInput = {}): Promise<Result<SweepTestSessionsResult>> {
    const now = input.now ?? new Date();
    const retentionDays = input.retentionDays ?? DEFAULT_TEST_SESSION_RETENTION_DAYS;
    const batchSize = input.batchSize ?? DEFAULT_SWEEP_BATCH_SIZE;

    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    const holds = await this.legalHolds.listActive();
    if (holds.error) return holds;
    // A global hold freezes everything, test runs included. Sweeping under one
    // would be exactly the deletion the hold exists to prevent (ADR-033).
    if (hasGlobalHold(holds.data)) return ok({ deleted: 0, more: false });
    const excludedSessionIds = heldSessionIds(holds.data);

    const expired = await this.sessions.listTestSessionsOlderThan(
      cutoff,
      batchSize,
      excludedSessionIds,
    );
    if (expired.error) return expired;

    let deleted = 0;
    for (const session of expired.data) {
      const removed = await this.sessions.deleteTestSession(session.id);
      // One undeletable row must not strand the rest of the batch; the next tick
      // will find it again.
      if (removed.error) continue;
      deleted += 1;
    }

    return ok({ deleted, more: expired.data.length === batchSize });
  }
}
