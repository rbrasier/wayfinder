import {
  LOGIN_NOTICE_CONFIG_SETTING_KEY,
  LOGIN_NOTICE_RESOURCE_TYPE,
  LOGIN_NOTICE_TEXT_MAX_LENGTH,
  LOGIN_NOTICE_UPDATED_ACTION,
  createDefaultLoginNoticeConfig,
  domainError,
  err,
  nextLoginNoticeVersion,
  ok,
  parseLoginNoticeConfig,
  type IAuditLogger,
  type ISystemSettingsRepository,
  type LoginNoticeConfig,
  type LoginNoticeMode,
  type Result,
} from "@rbrasier/domain";

export interface SetLoginNoticeInput {
  readonly mode: LoginNoticeMode;
  readonly text: string;
}

// Saves the sign-in notice. Rewording it bumps the version, which re-asks every
// user; changing only the mode does not (ADR-060 §5).
export class SetLoginNotice {
  constructor(
    private readonly systemSettings: ISystemSettingsRepository,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(input: SetLoginNoticeInput, actorId: string): Promise<Result<LoginNoticeConfig>> {
    if (input.text.length > LOGIN_NOTICE_TEXT_MAX_LENGTH) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Keep the notice to ${LOGIN_NOTICE_TEXT_MAX_LENGTH} characters or fewer.`,
        ),
      );
    }
    if (input.mode !== "off" && input.text.trim().length === 0) {
      return err(domainError("VALIDATION_FAILED", "Add the notice text before turning it on."));
    }

    const current = await this.systemSettings.get(LOGIN_NOTICE_CONFIG_SETTING_KEY);
    if (current.error) return current;
    const previous = current.data
      ? parseLoginNoticeConfig(current.data.value)
      : createDefaultLoginNoticeConfig();

    const next: LoginNoticeConfig = {
      mode: input.mode,
      text: input.text,
      version: nextLoginNoticeVersion(previous, input.text),
    };
    const saved = await this.systemSettings.set(LOGIN_NOTICE_CONFIG_SETTING_KEY, JSON.stringify(next));
    if (saved.error) return saved;

    await this.auditLogger.log({
      actorId,
      action: LOGIN_NOTICE_UPDATED_ACTION,
      resourceType: LOGIN_NOTICE_RESOURCE_TYPE,
      resourceId: String(next.version),
      metadata: { mode: next.mode, version: next.version },
    });
    return ok(next);
  }
}
