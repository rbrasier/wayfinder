import { describe, expect, it } from "vitest";
import type { AuditLog } from "./audit-log";
import {
  LOGIN_NOTICE_ACKNOWLEDGED_ACTION,
  createDefaultLoginNoticeConfig,
  isLoginNoticeDue,
  isLoginNoticeEnabled,
  nextLoginNoticeVersion,
  parseLoginNoticeConfig,
  toLoginNoticeAcknowledgement,
  type LoginNoticeConfig,
} from "./login-notice";

const notice = (overrides: Partial<LoginNoticeConfig> = {}): LoginNoticeConfig => ({
  mode: "once",
  text: "This system is for authorised use only.",
  version: 2,
  ...overrides,
});

const auditRow = (overrides: Partial<AuditLog> = {}): AuditLog => ({
  id: "audit-1",
  actorId: "user-1",
  action: LOGIN_NOTICE_ACKNOWLEDGED_ACTION,
  resourceType: "login_notice",
  resourceId: "2",
  metadata: { version: 2, authSessionId: "session-a" },
  createdAt: new Date("2026-09-23T09:00:00Z"),
  sequence: 10,
  prevHash: "prev",
  hash: "hash",
  ...overrides,
});

describe("createDefaultLoginNoticeConfig", () => {
  it("ships switched off, so an upgrade interrupts nobody", () => {
    expect(createDefaultLoginNoticeConfig()).toEqual({ mode: "off", text: "", version: 0 });
  });
});

describe("isLoginNoticeEnabled", () => {
  it("is off when the mode is off", () => {
    expect(isLoginNoticeEnabled(notice({ mode: "off" }))).toBe(false);
  });

  it("is off when there is nothing to say, whatever the mode", () => {
    expect(isLoginNoticeEnabled(notice({ text: "   " }))).toBe(false);
  });

  it("is on for once and every_sign_in with text", () => {
    expect(isLoginNoticeEnabled(notice({ mode: "once" }))).toBe(true);
    expect(isLoginNoticeEnabled(notice({ mode: "every_sign_in" }))).toBe(true);
  });
});

describe("nextLoginNoticeVersion", () => {
  it("bumps the version when the wording changes, so everyone is asked again", () => {
    expect(nextLoginNoticeVersion(notice({ version: 2 }), "New wording")).toBe(3);
  });

  it("keeps the version when only the mode changes", () => {
    expect(nextLoginNoticeVersion(notice({ version: 2 }), notice().text)).toBe(2);
  });

  it("starts at 1 the first time text is written", () => {
    expect(nextLoginNoticeVersion(createDefaultLoginNoticeConfig(), "Hello")).toBe(1);
  });
});

describe("isLoginNoticeDue", () => {
  it("is never due when the notice is off", () => {
    expect(isLoginNoticeDue(notice({ mode: "off" }), [], "session-a")).toBe(false);
  });

  describe("once", () => {
    it("is due when the user has not acknowledged this version", () => {
      expect(isLoginNoticeDue(notice(), [], "session-a")).toBe(true);
    });

    it("is not due once the current version is acknowledged, in any session", () => {
      const acknowledgements = [{ version: 2, authSessionId: "an-earlier-session" }];

      expect(isLoginNoticeDue(notice(), acknowledgements, "session-b")).toBe(false);
    });

    it("is due again after the wording changes", () => {
      const acknowledgements = [{ version: 1, authSessionId: "session-a" }];

      expect(isLoginNoticeDue(notice({ version: 2 }), acknowledgements, "session-a")).toBe(true);
    });
  });

  describe("every_sign_in", () => {
    const everySignIn = notice({ mode: "every_sign_in" });

    it("is not due once acknowledged in this sign-in session", () => {
      const acknowledgements = [{ version: 2, authSessionId: "session-a" }];

      expect(isLoginNoticeDue(everySignIn, acknowledgements, "session-a")).toBe(false);
    });

    it("is due in a new sign-in session even after an earlier acknowledgement", () => {
      const acknowledgements = [{ version: 2, authSessionId: "session-a" }];

      expect(isLoginNoticeDue(everySignIn, acknowledgements, "session-b")).toBe(true);
    });

    it("is due in the same session after the wording changes", () => {
      const acknowledgements = [{ version: 1, authSessionId: "session-a" }];

      expect(isLoginNoticeDue(everySignIn, acknowledgements, "session-a")).toBe(true);
    });
  });
});

describe("toLoginNoticeAcknowledgement", () => {
  it("reads the version and session from an acknowledgement audit row", () => {
    expect(toLoginNoticeAcknowledgement(auditRow())).toEqual({
      version: 2,
      authSessionId: "session-a",
    });
  });

  it("ignores rows for other actions", () => {
    expect(toLoginNoticeAcknowledgement(auditRow({ action: "branding.updated" }))).toBeNull();
  });

  it("ignores a row whose metadata has no usable version", () => {
    expect(toLoginNoticeAcknowledgement(auditRow({ metadata: { version: "two" } }))).toBeNull();
    expect(toLoginNoticeAcknowledgement(auditRow({ metadata: null }))).toBeNull();
  });

  it("keeps a row with no session id, which only matters in once mode", () => {
    expect(toLoginNoticeAcknowledgement(auditRow({ metadata: { version: 2 } }))).toEqual({
      version: 2,
      authSessionId: null,
    });
  });
});

describe("parseLoginNoticeConfig", () => {
  it("reads a complete row", () => {
    const raw = JSON.stringify({ mode: "every_sign_in", text: "Hello", version: 4 });

    expect(parseLoginNoticeConfig(raw)).toEqual({ mode: "every_sign_in", text: "Hello", version: 4 });
  });

  it("falls back to off for an unrecognised mode rather than trusting it", () => {
    const raw = JSON.stringify({ mode: "always", text: "Hello", version: 4 });

    expect(parseLoginNoticeConfig(raw).mode).toBe("off");
  });

  it("returns the defaults for malformed JSON", () => {
    expect(parseLoginNoticeConfig("nope")).toEqual(createDefaultLoginNoticeConfig());
  });

  it("drops a version that is not a whole, non-negative number", () => {
    const raw = JSON.stringify({ mode: "once", text: "Hello", version: -3 });

    expect(parseLoginNoticeConfig(raw).version).toBe(0);
  });
});
