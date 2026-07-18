import type { LegalHold, NewLegalHold } from "../entities/legal-hold";
import type { Result } from "../result";

export interface ILegalHoldRepository {
  create(hold: NewLegalHold): Promise<Result<LegalHold>>;
  // Every hold, newest-first, for the admin list (active and released).
  list(): Promise<Result<LegalHold[]>>;
  // Only unreleased holds — consumed by the retention guard on the hot sweep.
  listActive(): Promise<Result<LegalHold[]>>;
  // Marks a hold released (sets releasedAt). Re-enables pruning on the next run.
  release(id: string): Promise<Result<LegalHold>>;
}
