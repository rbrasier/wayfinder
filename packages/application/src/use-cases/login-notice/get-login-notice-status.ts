import {
  LOGIN_NOTICE_ACKNOWLEDGED_ACTION,
  isLoginNoticeDue,
  isLoginNoticeEnabled,
  ok,
  toLoginNoticeAcknowledgement,
  type IAuditQueryRepository,
  type LoginNoticeAcknowledgement,
  type LoginNoticeConfig,
  type Result,
} from "@rbrasier/domain";

export interface LoginNoticeStatus {
  readonly due: boolean;
  // Empty unless due, so a user who has acknowledged is not sent the text again.
  readonly text: string;
  readonly version: number;
}

// Newest first, and the current sign-in's acknowledgement is almost always the
// newest; the headroom covers the same person acknowledging on other devices.
const ACKNOWLEDGEMENT_LOOKBACK = 20;

// Answers "must this person acknowledge the notice now?" from the audit log
// (ADR-060 §5). The config comes through the runtime cache, so an install with
// the notice off never queries the audit table.
export class GetLoginNoticeStatus {
  constructor(
    private readonly loadConfig: () => Promise<LoginNoticeConfig>,
    private readonly auditQuery: IAuditQueryRepository,
  ) {}

  async execute(userId: string, authSessionId: string | null): Promise<Result<LoginNoticeStatus>> {
    const config = await this.loadConfig();
    if (!isLoginNoticeEnabled(config)) return ok({ due: false, text: "", version: config.version });

    const page = await this.auditQuery.search({
      filter: {
        actorId: userId,
        action: LOGIN_NOTICE_ACKNOWLEDGED_ACTION,
        resourceId: String(config.version),
      },
      limit: ACKNOWLEDGEMENT_LOOKBACK,
      offset: 0,
    });
    if (page.error) return page;

    const acknowledgements = page.data.rows
      .map(toLoginNoticeAcknowledgement)
      .filter((acknowledgement): acknowledgement is LoginNoticeAcknowledgement => acknowledgement !== null);
    const due = isLoginNoticeDue(config, acknowledgements, authSessionId);
    return ok({ due, text: due ? config.text : "", version: config.version });
  }
}
