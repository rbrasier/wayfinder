import type { NewAuditLog } from "../entities/audit-log";
import type { Result } from "../result";

export interface IAuditLogger {
  log(payload: NewAuditLog): Promise<Result<true>>;
}
