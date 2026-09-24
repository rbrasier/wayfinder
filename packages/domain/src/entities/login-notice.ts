import type { AuditLog } from "./audit-log";

// A notice every user must acknowledge after signing in (ADR-060 §5). Stored as
// one JSON row in admin_system_settings (ADR-041). Acknowledgements are audit
// events, not state: the tamper-evident log is both the governance record and
// the answer to "has this person seen it".

// A closed set: the mode decides whether a user is blocked, so an unrecognised
// stored string falls back to "off" rather than being trusted.
export const LOGIN_NOTICE_MODES = ["off", "once", "every_sign_in"] as const;
export type LoginNoticeMode = (typeof LOGIN_NOTICE_MODES)[number];

export interface LoginNoticeConfig {
  readonly mode: LoginNoticeMode;
  readonly text: string;
  // Bumped whenever the text changes, so a reworded notice is asked again.
  readonly version: number;
}

export interface LoginNoticeAcknowledgement {
  readonly version: number;
  // core_sessions.id — never the session token, which is a bearer secret.
  readonly authSessionId: string | null;
}

export const LOGIN_NOTICE_CONFIG_SETTING_KEY = "login_notice_config";
export const LOGIN_NOTICE_TEXT_MAX_LENGTH = 1000;
export const LOGIN_NOTICE_ACKNOWLEDGED_ACTION = "login_notice.acknowledged";
export const LOGIN_NOTICE_UPDATED_ACTION = "login_notice.updated";
export const LOGIN_NOTICE_RESOURCE_TYPE = "login_notice";

export const createDefaultLoginNoticeConfig = (): LoginNoticeConfig => ({
  mode: "off",
  text: "",
  version: 0,
});

// A blocking modal with nothing in it would lock people out behind an empty box,
// so blank text disables the notice just as firmly as the mode does.
export const isLoginNoticeEnabled = (config: LoginNoticeConfig): boolean =>
  config.mode !== "off" && config.text.trim().length > 0;

export const nextLoginNoticeVersion = (previous: LoginNoticeConfig, incomingText: string): number =>
  incomingText === previous.text ? previous.version : previous.version + 1;

export const isLoginNoticeDue = (
  config: LoginNoticeConfig,
  acknowledgements: readonly LoginNoticeAcknowledgement[],
  authSessionId: string | null,
): boolean => {
  if (!isLoginNoticeEnabled(config)) return false;
  const currentVersion = acknowledgements.filter(
    (acknowledgement) => acknowledgement.version === config.version,
  );
  if (config.mode === "once") return currentVersion.length === 0;
  return !currentVersion.some((acknowledgement) => acknowledgement.authSessionId === authSessionId);
};

export const toLoginNoticeAcknowledgement = (row: AuditLog): LoginNoticeAcknowledgement | null => {
  if (row.action !== LOGIN_NOTICE_ACKNOWLEDGED_ACTION) return null;
  const version = row.metadata?.version;
  if (typeof version !== "number" || !Number.isInteger(version)) return null;
  const authSessionId = row.metadata?.authSessionId;
  return { version, authSessionId: typeof authSessionId === "string" ? authSessionId : null };
};

const isLoginNoticeMode = (value: unknown): value is LoginNoticeMode =>
  typeof value === "string" && (LOGIN_NOTICE_MODES as readonly string[]).includes(value);

const isVersion = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

// Tolerant parse: a malformed row degrades field by field rather than throwing
// on a path that runs after every sign-in.
export const parseLoginNoticeConfig = (
  raw: string,
  fallback: LoginNoticeConfig = createDefaultLoginNoticeConfig(),
): LoginNoticeConfig => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return fallback;
    const source = parsed as Record<string, unknown>;
    return {
      mode: isLoginNoticeMode(source.mode) ? source.mode : "off",
      text: typeof source.text === "string" ? source.text : fallback.text,
      version: isVersion(source.version) ? source.version : fallback.version,
    };
  } catch {
    return fallback;
  }
};
