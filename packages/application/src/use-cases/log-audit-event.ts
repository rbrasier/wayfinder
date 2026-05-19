import type { IAuditLogger, NewAuditLog, Result } from "@rbrasier/domain";

export class LogAuditEvent {
  constructor(private readonly logger: IAuditLogger) {}

  execute(payload: NewAuditLog): Promise<Result<true>> {
    return this.logger.log(payload);
  }
}
