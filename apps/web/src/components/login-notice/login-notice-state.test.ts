import { describe, expect, it } from "vitest";
import { isLoginNoticeCleared, loginNoticeSaveHint, shouldShowLoginNotice } from "./login-notice-state";

const dueStatus = { due: true, text: "Authorised use only.", version: 3 };

describe("shouldShowLoginNotice", () => {
  it("shows a due notice the user has not acknowledged yet", () => {
    expect(shouldShowLoginNotice(dueStatus, null)).toBe(true);
  });

  it("hides it the moment the user acknowledges, before the server answers", () => {
    expect(shouldShowLoginNotice(dueStatus, 3)).toBe(false);
  });

  it("shows it again if the wording changed after an earlier acknowledgement in this tab", () => {
    expect(shouldShowLoginNotice({ ...dueStatus, version: 4 }, 3)).toBe(true);
  });

  it("stays hidden while the status is loading, or when nothing is due", () => {
    expect(shouldShowLoginNotice(undefined, null)).toBe(false);
    expect(shouldShowLoginNotice({ due: false, text: "", version: 3 }, null)).toBe(false);
  });

  it("never shows an empty box", () => {
    expect(shouldShowLoginNotice({ ...dueStatus, text: "  " }, null)).toBe(false);
  });
});

describe("isLoginNoticeCleared", () => {
  it("holds the other sign-in prompts back while the status is loading", () => {
    expect(isLoginNoticeCleared({ status: undefined, failed: false }, null)).toBe(false);
  });

  it("clears when nothing is due", () => {
    expect(isLoginNoticeCleared({ status: { due: false, text: "", version: 0 }, failed: false }, null)).toBe(
      true,
    );
  });

  it("clears once acknowledged", () => {
    expect(isLoginNoticeCleared({ status: dueStatus, failed: false }, 3)).toBe(true);
  });

  it("clears when the status lookup fails, so an outage never locks anyone out", () => {
    expect(isLoginNoticeCleared({ status: undefined, failed: true }, null)).toBe(true);
  });

  it("stays blocked while a due notice is on screen", () => {
    expect(isLoginNoticeCleared({ status: dueStatus, failed: false }, null)).toBe(false);
  });
});

describe("loginNoticeSaveHint", () => {
  const saved = { mode: "once" as const, text: "Authorised use only.", version: 3 };

  it("warns that new wording re-asks everyone", () => {
    expect(loginNoticeSaveHint(saved, { mode: "once", text: "New wording." })).toBe(
      "Saving new wording asks everyone to acknowledge it again.",
    );
  });

  it("says nothing when only the mode changes", () => {
    expect(loginNoticeSaveHint(saved, { mode: "every_sign_in", text: saved.text })).toBeNull();
  });

  it("says nothing about rewording while the notice is off", () => {
    expect(loginNoticeSaveHint(saved, { mode: "off", text: "Draft for later." })).toBeNull();
  });

  it("explains why an empty notice can't be switched on", () => {
    expect(loginNoticeSaveHint(saved, { mode: "once", text: " " })).toBe(
      "Add the notice text before turning it on.",
    );
  });
});
