import { describe, expect, it, vi } from "vitest";
import { handleSessionCreated } from "./new-chat-model";

const effects = () => {
  const calls: string[] = [];
  return {
    calls,
    closeDialog: vi.fn(() => void calls.push("closeDialog")),
    refreshSessionList: vi.fn(() => void calls.push("refreshSessionList")),
    navigateToSession: vi.fn(() => void calls.push("navigateToSession")),
  };
};

describe("handleSessionCreated", () => {
  it("closes the dialog, so it cannot sit on top of the chat it just opened", () => {
    const handlers = effects();

    handleSessionCreated("session-1", handlers);

    expect(handlers.closeDialog).toHaveBeenCalledTimes(1);
  });

  it("closes the dialog before navigating", () => {
    const handlers = effects();

    handleSessionCreated("session-1", handlers);

    expect(handlers.calls.indexOf("closeDialog")).toBeLessThan(
      handlers.calls.indexOf("navigateToSession"),
    );
  });

  it("refreshes the session list so the new chat is listed on return", () => {
    const handlers = effects();

    handleSessionCreated("session-1", handlers);

    expect(handlers.refreshSessionList).toHaveBeenCalledTimes(1);
  });

  it("navigates to the session that was created", () => {
    const handlers = effects();

    handleSessionCreated("session-abc", handlers);

    expect(handlers.navigateToSession).toHaveBeenCalledWith("session-abc");
  });
});
