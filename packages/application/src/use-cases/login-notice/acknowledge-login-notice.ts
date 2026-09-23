import {
  LOGIN_NOTICE_ACKNOWLEDGED_ACTION,
  LOGIN_NOTICE_RESOURCE_TYPE,
  domainError,
  err,
  isLoginNoticeEnabled,
  type IAuditLogger,
  type LoginNoticeConfig,
  type Result,
} from "@rbrasier/domain";

// Records that a user read the notice. The audit row is the acknowledgement
// itself (ADR-060 §5), so unlike an admin change a failed write is an error.
export class AcknowledgeLoginNotice {
  constructor(
    private readonly loadConfig: () => Promise<LoginNoticeConfig>,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(
    userId: string,
    authSessionId: string | null,
    version: number,
  ): Promise<Result<true>> {
    const config = await this.loadConfig();
    if (!isLoginNoticeEnabled(config)) {
      return err(domainError("CONFLICT", "There is no sign-in notice to acknowledge."));
    }
    if (version !== config.version) {
      return err(domainError("CONFLICT", "The notice has changed. Please read the new version."));
    }

    return this.auditLogger.log({
      actorId: userId,
      action: LOGIN_NOTICE_ACKNOWLEDGED_ACTION,
      resourceType: LOGIN_NOTICE_RESOURCE_TYPE,
      resourceId: String(version),
      metadata: { version, authSessionId },
    });
  }
}
