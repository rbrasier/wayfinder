import { describe, expect, it, vi } from "vitest";
import { createDefaultChatDisclaimerConfig, type ChatDisclaimerConfig } from "@rbrasier/domain";
import {
  ACKNOWLEDGED_VALUE,
  hasAcknowledgedDisclaimer,
  rememberDisclaimerAcknowledgement,
  shouldOpenDisclaimerModal,
} from "./chat-disclaimer-state";

const configWith = (overrides: Partial<ChatDisclaimerConfig>): ChatDisclaimerConfig => ({
  ...createDefaultChatDisclaimerConfig(),
  ...overrides,
});

const fakeStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    read: (key: string) => values.get(key) ?? null,
  };
};

const throwingStorage = () => ({
  getItem: vi.fn(() => {
    throw new Error("site data blocked");
  }),
  setItem: vi.fn(() => {
    throw new Error("site data blocked");
  }),
});

describe("hasAcknowledgedDisclaimer", () => {
  it("is true once the key holds the acknowledgement value", () => {
    const storage = fakeStorage({ "key-1": ACKNOWLEDGED_VALUE });

    expect(hasAcknowledgedDisclaimer(storage, "key-1")).toBe(true);
  });

  it("is false when the key is absent or holds something else", () => {
    const storage = fakeStorage({ "key-1": "maybe" });

    expect(hasAcknowledgedDisclaimer(storage, "key-1")).toBe(false);
    expect(hasAcknowledgedDisclaimer(storage, "key-2")).toBe(false);
  });

  it("is false for a null key, so a disabled modal stores and reads nothing", () => {
    const storage = fakeStorage();

    expect(hasAcknowledgedDisclaimer(storage, null)).toBe(false);
  });

  it("reads as not acknowledged when storage throws, so the warning still shows", () => {
    expect(hasAcknowledgedDisclaimer(throwingStorage(), "key-1")).toBe(false);
  });

  it("reads as not acknowledged when there is no storage at all", () => {
    expect(hasAcknowledgedDisclaimer(null, "key-1")).toBe(false);
  });
});

describe("rememberDisclaimerAcknowledgement", () => {
  it("writes the acknowledgement under the key", () => {
    const storage = fakeStorage();

    rememberDisclaimerAcknowledgement(storage, "key-1");

    expect(storage.read("key-1")).toBe(ACKNOWLEDGED_VALUE);
  });

  it("writes nothing for a null key", () => {
    const storage = fakeStorage();
    const setItem = vi.spyOn(storage, "setItem");

    rememberDisclaimerAcknowledgement(storage, null);

    expect(setItem).not.toHaveBeenCalled();
  });

  it("swallows a storage that refuses to write", () => {
    expect(() => rememberDisclaimerAcknowledgement(throwingStorage(), "key-1")).not.toThrow();
  });
});

describe("shouldOpenDisclaimerModal", () => {
  it("is false when the mode is off", () => {
    const storage = fakeStorage();

    expect(shouldOpenDisclaimerModal(createDefaultChatDisclaimerConfig(), "u1", "s1", storage)).toBe(
      false,
    );
  });

  it("is false when the message is blank", () => {
    const config = configWith({ modalMode: "once", modalText: "  " });

    expect(shouldOpenDisclaimerModal(config, "u1", "s1", fakeStorage())).toBe(false);
  });

  it("is true in once mode until the user acknowledges it", () => {
    const config = configWith({ modalMode: "once" });
    const storage = fakeStorage();

    expect(shouldOpenDisclaimerModal(config, "u1", "s1", storage)).toBe(true);

    rememberDisclaimerAcknowledgement(storage, "wayfinder.chat-disclaimer.once.u1");

    expect(shouldOpenDisclaimerModal(config, "u1", "s1", storage)).toBe(false);
    expect(shouldOpenDisclaimerModal(config, "u1", "s2", storage)).toBe(false);
  });

  it("is true again for a new chat in every_session mode", () => {
    const config = configWith({ modalMode: "every_session" });
    const storage = fakeStorage();

    rememberDisclaimerAcknowledgement(storage, "wayfinder.chat-disclaimer.session.u1.s1");

    expect(shouldOpenDisclaimerModal(config, "u1", "s1", storage)).toBe(false);
    expect(shouldOpenDisclaimerModal(config, "u1", "s2", storage)).toBe(true);
  });

  it("is true when there is no config yet only after one arrives — a null config shows nothing", () => {
    expect(shouldOpenDisclaimerModal(null, "u1", "s1", fakeStorage())).toBe(false);
  });
});
