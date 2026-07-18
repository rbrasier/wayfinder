import type { ChainedAuditRow } from "../entities/audit-hash";
import type { AuditLog } from "../entities/audit-log";
import type { AuditQuery } from "../entities/audit-query";
import type { Result } from "../result";

export interface AuditPage {
  readonly rows: AuditLog[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface IAuditQueryRepository {
  // One page of the filtered set, newest-first, with the total match count.
  search(query: AuditQuery): Promise<Result<AuditPage>>;
  getById(id: string): Promise<Result<AuditLog | null>>;
  // Every row matching the filter, ignoring pagination — backs CSV/JSON export.
  exportRows(query: AuditQuery): Promise<Result<AuditLog[]>>;
  // All rows ordered by ascending sequence, for on-demand chain verification.
  loadChain(): Promise<Result<ChainedAuditRow[]>>;
}
