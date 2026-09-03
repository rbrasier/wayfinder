import { describe, expect, it } from "vitest";
import {
  CHAT_DISCLAIMER_MODAL_MODES,
  DEFAULT_CHAT_DISCLAIMER_COMPOSER_TEXT,
  DEFAULT_CHAT_DISCLAIMER_MODAL_TEXT,
  chatDisclaimerAcknowledgementKey,
  createDefaultChatDisclaimerConfig,
  isChatDisclaimerModalEnabled,
  parseChatDisclaimerConfig,
  resolveChatDisclaimerComposerText,
} from "./chat-disclaimer";

describe("createDefaultChatDisclaimerConfig", () => {
  it("ships the verification wording under the composer with the modal off", () => {
    expect(createDefaultChatDisclaimerConfig()).toEqual({
      composerText: DEFAULT_CHAT_DISCLAIMER_COMPOSER_TEXT,
      modalMode: "off",
      modalText: DEFAULT_CHAT_DISCLAIMER_MODAL_TEXT,
    });
  });

  it("returns a fresh object each call so callers cannot mutate the default", () => {
    const first = createDefaultChatDisclaimerConfig();
    first.modalMode = "once";
    expect(createDefaultChatDisclaimerConfig().modalMode).toBe("off");
  });

  it("names the three modes an admin can choose", () => {
    expect(CHAT_DISCLAIMER_MODAL_MODES).toEqual(["off", "once", "every_session"]);
  });
});

describe("parseChatDisclaimerConfig", () => {
  it("reads a fully specified row", () => {
    const raw = JSON.stringify({
      composerText: "Check everything.",
      modalMode: "every_session",
      modalText: "Verify all output.",
    });
    expect(parseChatDisclaimerConfig(raw)).toEqual({
      composerText: "Check everything.",
      modalMode: "every_session",
      modalText: "Verify all output.",
    });
  });

  it("keeps an empty composer text, because blank is how an admin hides the line", () => {
    const raw = JSON.stringify({ composerText: "" });
    expect(parseChatDisclaimerConfig(raw).composerText).toBe("");
  });

  it("falls back field by field for a partial row", () => {
    const raw = JSON.stringify({ modalMode: "once" });
    expect(parseChatDisclaimerConfig(raw)).toEqual({
      composerText: DEFAULT_CHAT_DISCLAIMER_COMPOSER_TEXT,
      modalMode: "once",
      modalText: DEFAULT_CHAT_DISCLAIMER_MODAL_TEXT,
    });
  });

  it("falls back for an unknown mode rather than trusting the stored string", () => {
    const raw = JSON.stringify({ modalMode: "always" });
    expect(parseChatDisclaimerConfig(raw).modalMode).toBe("off");
  });

  it("falls back for non-string text fields", () => {
    const raw = JSON.stringify({ composerText: 42, modalText: null });
    expect(parseChatDisclaimerConfig(raw)).toEqual(createDefaultChatDisclaimerConfig());
  });

  it("falls back for malformed JSON, an array or a bare value", () => {
    expect(parseChatDisclaimerConfig("{ not json")).toEqual(createDefaultChatDisclaimerConfig());
    expect(parseChatDisclaimerConfig("[]")).toEqual(createDefaultChatDisclaimerConfig());
    expect(parseChatDisclaimerConfig("null")).toEqual(createDefaultChatDisclaimerConfig());
  });

  it("honours a caller-supplied fallback", () => {
    const fallback = {
      composerText: "House wording.",
      modalMode: "once" as const,
      modalText: "House modal.",
    };
    expect(parseChatDisclaimerConfig("{}", fallback)).toEqual(fallback);
  });
});

describe("resolveChatDisclaimerComposerText", () => {
  it("returns the configured text", () => {
    const config = { ...createDefaultChatDisclaimerConfig(), composerText: "  Verify output.  " };
    expect(resolveChatDisclaimerComposerText(config)).toBe("Verify output.");
  });

  it("returns null for blank or whitespace-only text, so no line renders", () => {
    expect(
      resolveChatDisclaimerComposerText({ ...createDefaultChatDisclaimerConfig(), composerText: "" }),
    ).toBeNull();
    expect(
      resolveChatDisclaimerComposerText({
        ...createDefaultChatDisclaimerConfig(),
        composerText: "   ",
      }),
    ).toBeNull();
  });
});

describe("isChatDisclaimerModalEnabled", () => {
  it("is off by default", () => {
    expect(isChatDisclaimerModalEnabled(createDefaultChatDisclaimerConfig())).toBe(false);
  });

  it("is on for once and every_session with a message", () => {
    const base = createDefaultChatDisclaimerConfig();
    expect(isChatDisclaimerModalEnabled({ ...base, modalMode: "once" })).toBe(true);
    expect(isChatDisclaimerModalEnabled({ ...base, modalMode: "every_session" })).toBe(true);
  });

  it("is off when the message is blank, whatever the mode", () => {
    const base = { ...createDefaultChatDisclaimerConfig(), modalText: "   " };
    expect(isChatDisclaimerModalEnabled({ ...base, modalMode: "once" })).toBe(false);
    expect(isChatDisclaimerModalEnabled({ ...base, modalMode: "every_session" })).toBe(false);
  });
});

describe("chatDisclaimerAcknowledgementKey", () => {
  const base = createDefaultChatDisclaimerConfig();

  it("is null when the modal is disabled, so nothing is stored", () => {
    expect(chatDisclaimerAcknowledgementKey(base, "user-1", "session-1")).toBeNull();
    expect(
      chatDisclaimerAcknowledgementKey(
        { ...base, modalMode: "once", modalText: "" },
        "user-1",
        "session-1",
      ),
    ).toBeNull();
  });

  it("keys on the user alone in once mode, so a second chat does not re-prompt", () => {
    const config = { ...base, modalMode: "once" as const };
    expect(chatDisclaimerAcknowledgementKey(config, "user-1", "session-1")).toBe(
      "wayfinder.chat-disclaimer.once.user-1",
    );
    expect(chatDisclaimerAcknowledgementKey(config, "user-1", "session-2")).toBe(
      chatDisclaimerAcknowledgementKey(config, "user-1", "session-1"),
    );
  });

  it("keys on user and session in every_session mode, so each new chat prompts once", () => {
    const config = { ...base, modalMode: "every_session" as const };
    expect(chatDisclaimerAcknowledgementKey(config, "user-1", "session-1")).toBe(
      "wayfinder.chat-disclaimer.session.user-1.session-1",
    );
    expect(chatDisclaimerAcknowledgementKey(config, "user-1", "session-2")).not.toBe(
      chatDisclaimerAcknowledgementKey(config, "user-1", "session-1"),
    );
  });

  it("separates users in both modes", () => {
    const once = { ...base, modalMode: "once" as const };
    const every = { ...base, modalMode: "every_session" as const };
    expect(chatDisclaimerAcknowledgementKey(once, "user-1", "s")).not.toBe(
      chatDisclaimerAcknowledgementKey(once, "user-2", "s"),
    );
    expect(chatDisclaimerAcknowledgementKey(every, "user-1", "s")).not.toBe(
      chatDisclaimerAcknowledgementKey(every, "user-2", "s"),
    );
  });
});
