import { describe, expect, it } from "vitest";
import {
  LOGIN_NOTICE_ACKNOWLEDGED_ACTION,
  LOGIN_NOTICE_CONFIG_SETTING_KEY,
  parseLoginNoticeConfig,
  type LoginNoticeConfig,
} from "@rbrasier/domain";
import { InMemoryAuditLog, InMemorySystemSettings } from "../__fixtures__/presentation-doubles";
import { AcknowledgeLoginNotice } from "./acknowledge-login-notice";
import { GetLoginNoticeStatus } from "./get-login-notice-status";
import { SetLoginNotice } from "./set-login-notice";

const ADMIN_ID = "admin-1";
const USER_ID = "user-1";
const NOTICE_TEXT = "This system is for authorised use only.";

const configOf = (config: LoginNoticeConfig) => async (): Promise<LoginNoticeConfig> => config;

describe("SetLoginNotice", () => {
  it("saves the notice at version 1 the first time it has text", async () => {
    const settings = new InMemorySystemSettings();
    const audit = new InMemoryAuditLog();

    const result = await new SetLoginNotice(settings, audit).execute(
      { mode: "once", text: NOTICE_TEXT },
      ADMIN_ID,
    );

    expect(result.data).toEqual({ mode: "once", text: NOTICE_TEXT, version: 1 });
    expect(parseLoginNoticeConfig(settings.values.get(LOGIN_NOTICE_CONFIG_SETTING_KEY) ?? "")).toEqual(
      result.data,
    );
    expect(audit.rows.map((row) => row.action)).toEqual(["login_notice.updated"]);
  });

  it("bumps the version when the wording changes", async () => {
    const settings = new InMemorySystemSettings();
    const setNotice = new SetLoginNotice(settings, new InMemoryAuditLog());
    await setNotice.execute({ mode: "once", text: NOTICE_TEXT }, ADMIN_ID);

    const result = await setNotice.execute({ mode: "once", text: "New wording." }, ADMIN_ID);

    expect(result.data?.version).toBe(2);
  });

  it("keeps the version when only the mode changes, so nobody is asked again", async () => {
    const settings = new InMemorySystemSettings();
    const setNotice = new SetLoginNotice(settings, new InMemoryAuditLog());
    await setNotice.execute({ mode: "once", text: NOTICE_TEXT }, ADMIN_ID);

    const result = await setNotice.execute({ mode: "every_sign_in", text: NOTICE_TEXT }, ADMIN_ID);

    expect(result.data?.version).toBe(1);
  });

  it("refuses to switch on a notice with nothing to say", async () => {
    const settings = new InMemorySystemSettings();

    const result = await new SetLoginNotice(settings, new InMemoryAuditLog()).execute(
      { mode: "once", text: "   " },
      ADMIN_ID,
    );

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(settings.values.size).toBe(0);
  });

  it("allows saving blank text while the notice is off", async () => {
    const result = await new SetLoginNotice(new InMemorySystemSettings(), new InMemoryAuditLog()).execute(
      { mode: "off", text: "" },
      ADMIN_ID,
    );

    expect(result.data?.mode).toBe("off");
  });

  it("refuses text over the length limit", async () => {
    const result = await new SetLoginNotice(new InMemorySystemSettings(), new InMemoryAuditLog()).execute(
      { mode: "once", text: "x".repeat(1001) },
      ADMIN_ID,
    );

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("does not overwrite the row when it cannot be read", async () => {
    const settings = new InMemorySystemSettings();
    settings.failReads = true;

    const result = await new SetLoginNotice(settings, new InMemoryAuditLog()).execute(
      { mode: "once", text: NOTICE_TEXT },
      ADMIN_ID,
    );

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(settings.values.size).toBe(0);
  });
});

describe("GetLoginNoticeStatus", () => {
  it("is not due and never touches the audit log when the notice is off", async () => {
    const audit = new InMemoryAuditLog();

    const result = await new GetLoginNoticeStatus(
      configOf({ mode: "off", text: NOTICE_TEXT, version: 3 }),
      audit,
    ).execute(USER_ID, "session-a");

    expect(result.data).toEqual({ due: false, text: "", version: 3 });
    expect(audit.searches).toEqual([]);
  });

  it("is due, with the text to show, before the user has acknowledged", async () => {
    const result = await new GetLoginNoticeStatus(
      configOf({ mode: "once", text: NOTICE_TEXT, version: 3 }),
      new InMemoryAuditLog(),
    ).execute(USER_ID, "session-a");

    expect(result.data).toEqual({ due: true, text: NOTICE_TEXT, version: 3 });
  });

  it("only looks up this user's acknowledgements of the current version", async () => {
    const audit = new InMemoryAuditLog();

    await new GetLoginNoticeStatus(
      configOf({ mode: "once", text: NOTICE_TEXT, version: 3 }),
      audit,
    ).execute(USER_ID, "session-a");

    expect(audit.searches[0]?.filter).toEqual({
      actorId: USER_ID,
      action: LOGIN_NOTICE_ACKNOWLEDGED_ACTION,
      resourceId: "3",
    });
  });

  it("passes an audit failure back rather than guessing", async () => {
    const audit = new InMemoryAuditLog();
    audit.failSearches = true;

    const result = await new GetLoginNoticeStatus(
      configOf({ mode: "once", text: NOTICE_TEXT, version: 3 }),
      audit,
    ).execute(USER_ID, "session-a");

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});

describe("AcknowledgeLoginNotice then GetLoginNoticeStatus", () => {
  it("once: acknowledging clears the notice for later sign-ins too", async () => {
    const audit = new InMemoryAuditLog();
    const config = configOf({ mode: "once", text: NOTICE_TEXT, version: 3 });

    await new AcknowledgeLoginNotice(config, audit).execute(USER_ID, "session-a", 3);
    const later = await new GetLoginNoticeStatus(config, audit).execute(USER_ID, "session-b");

    expect(later.data?.due).toBe(false);
  });

  it("every_sign_in: acknowledging clears it for this sign-in only", async () => {
    const audit = new InMemoryAuditLog();
    const config = configOf({ mode: "every_sign_in", text: NOTICE_TEXT, version: 3 });

    await new AcknowledgeLoginNotice(config, audit).execute(USER_ID, "session-a", 3);
    const sameSignIn = await new GetLoginNoticeStatus(config, audit).execute(USER_ID, "session-a");
    const nextSignIn = await new GetLoginNoticeStatus(config, audit).execute(USER_ID, "session-b");

    expect(sameSignIn.data?.due).toBe(false);
    expect(nextSignIn.data?.due).toBe(true);
  });

  it("another user's acknowledgement does not count", async () => {
    const audit = new InMemoryAuditLog();
    const config = configOf({ mode: "once", text: NOTICE_TEXT, version: 3 });

    await new AcknowledgeLoginNotice(config, audit).execute("someone-else", "session-z", 3);
    const status = await new GetLoginNoticeStatus(config, audit).execute(USER_ID, "session-a");

    expect(status.data?.due).toBe(true);
  });
});

describe("AcknowledgeLoginNotice", () => {
  it("writes the version and the session id, never anything else about the session", async () => {
    const audit = new InMemoryAuditLog();

    const result = await new AcknowledgeLoginNotice(
      configOf({ mode: "once", text: NOTICE_TEXT, version: 3 }),
      audit,
    ).execute(USER_ID, "session-a", 3);

    expect(result.error).toBeUndefined();
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      actorId: USER_ID,
      action: LOGIN_NOTICE_ACKNOWLEDGED_ACTION,
      resourceType: "login_notice",
      resourceId: "3",
      metadata: { version: 3, authSessionId: "session-a" },
    });
  });

  it("refuses an acknowledgement of wording that has since changed", async () => {
    const audit = new InMemoryAuditLog();

    const result = await new AcknowledgeLoginNotice(
      configOf({ mode: "once", text: NOTICE_TEXT, version: 4 }),
      audit,
    ).execute(USER_ID, "session-a", 3);

    expect(result.error?.code).toBe("CONFLICT");
    expect(audit.rows).toEqual([]);
  });

  it("refuses when there is no notice to acknowledge", async () => {
    const result = await new AcknowledgeLoginNotice(
      configOf({ mode: "off", text: "", version: 0 }),
      new InMemoryAuditLog(),
    ).execute(USER_ID, "session-a", 0);

    expect(result.error?.code).toBe("CONFLICT");
  });

  it("reports a failed audit write, because the audit row is the acknowledgement", async () => {
    const audit = new InMemoryAuditLog();
    audit.failWrites = true;

    const result = await new AcknowledgeLoginNotice(
      configOf({ mode: "once", text: NOTICE_TEXT, version: 3 }),
      audit,
    ).execute(USER_ID, "session-a", 3);

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
