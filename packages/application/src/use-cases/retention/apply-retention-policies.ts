import {
  err,
  hasGlobalHold,
  heldSessionIds,
  isRetentionEnabled,
  ok,
  retentionCutoff,
  type IClock,
  type ILegalHoldRepository,
  type IRetentionRepository,
  type RetentionPolicy,
  type RetentionTargetKey,
  type Result,
} from "@rbrasier/domain";

export interface RetentionSweepResult {
  readonly key: RetentionTargetKey;
  readonly deleted: number;
  readonly batches: number;
  // A disabled target (retentionDays <= 0) is left untouched.
  readonly skipped?: boolean;
  // The whole sweep was frozen by an active global legal hold (ADR-033).
  readonly heldByGlobal?: boolean;
  // The per-target batch cap was reached with rows still eligible; the next tick
  // continues where this one stopped.
  readonly cappedByBatchLimit?: boolean;
  readonly error?: string;
}

export interface RetentionRunSummary {
  readonly targets: RetentionSweepResult[];
  readonly totalDeleted: number;
}

export interface RetentionOptions {
  readonly batchSize?: number;
  readonly maxBatchesPerTarget?: number;
}

const DEFAULT_BATCH_SIZE = 500;
// Caps one tick at maxBatchesPerTarget × batchSize rows per table, so a first
// run against a large backlog drains it over several ticks rather than in one
// long-running transaction.
const DEFAULT_MAX_BATCHES_PER_TARGET = 200;

// Sweeps the unbounded-growth tables (scaling wall #9). For each enabled policy
// it deletes expired rows in bounded batches until a batch comes back short or
// the per-target cap is hit. A failure on one target is recorded and the sweep
// moves on — one bad table never stalls the rest.
export class ApplyRetentionPolicies {
  private readonly batchSize: number;
  private readonly maxBatchesPerTarget: number;

  constructor(
    private readonly repository: IRetentionRepository,
    private readonly policies: RetentionPolicy[],
    private readonly clock: IClock,
    private readonly legalHolds: ILegalHoldRepository,
    options: RetentionOptions = {},
  ) {
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.maxBatchesPerTarget = options.maxBatchesPerTarget ?? DEFAULT_MAX_BATCHES_PER_TARGET;
  }

  async execute(): Promise<Result<RetentionRunSummary>> {
    // Legal hold is authoritative: a read failure here must abort the sweep
    // rather than risk deleting rows that might be held (ADR-033).
    const holds = await this.legalHolds.listActive();
    if (holds.error) return err(holds.error);

    const globalHold = hasGlobalHold(holds.data);
    const excludedSessionIds = heldSessionIds(holds.data);

    const now = this.clock.now();
    const targets: RetentionSweepResult[] = [];

    for (const policy of this.policies) {
      if (!isRetentionEnabled(policy)) {
        targets.push({ key: policy.key, deleted: 0, batches: 0, skipped: true });
        continue;
      }
      if (globalHold) {
        targets.push({ key: policy.key, deleted: 0, batches: 0, skipped: true, heldByGlobal: true });
        continue;
      }
      targets.push(await this.sweepTarget(policy, now, excludedSessionIds));
    }

    const totalDeleted = targets.reduce((sum, target) => sum + target.deleted, 0);
    return ok({ targets, totalDeleted });
  }

  private async sweepTarget(
    policy: RetentionPolicy,
    now: Date,
    excludedSessionIds: string[],
  ): Promise<RetentionSweepResult> {
    const cutoff = retentionCutoff(policy, now);
    let deleted = 0;
    let batches = 0;

    for (let batch = 0; batch < this.maxBatchesPerTarget; batch += 1) {
      const result = await this.repository.deleteExpired(
        policy.key,
        cutoff,
        this.batchSize,
        excludedSessionIds,
      );
      if (result.error) {
        return { key: policy.key, deleted, batches, error: result.error.message };
      }

      deleted += result.data;
      batches += 1;
      if (result.data < this.batchSize) {
        return { key: policy.key, deleted, batches };
      }
    }

    return { key: policy.key, deleted, batches, cappedByBatchLimit: true };
  }
}
