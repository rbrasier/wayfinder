import type { Result } from "../result";
import type { RetentionTargetKey } from "../entities/retention-policy";

// Deletes one bounded batch of expired rows from a single retention target and
// reports how many it removed. The caller (ApplyRetentionPolicies) loops until a
// batch comes back short, so no single statement holds a long lock or builds a
// giant transaction. Implementations must resolve `key` against a fixed table
// allowlist — the key is never an identifier taken from request input.
//
// `excludedSessionIds` are sessions frozen by an active by_session legal hold
// (ADR-033): session-scoped targets (messages, audit) must not delete rows tied
// to them. Non-session targets ignore the list.
export interface IRetentionRepository {
  deleteExpired(
    key: RetentionTargetKey,
    cutoff: Date,
    batchSize: number,
    excludedSessionIds: string[],
  ): Promise<Result<number>>;
}
