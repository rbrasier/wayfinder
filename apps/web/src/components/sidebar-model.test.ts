import { describe, expect, it } from "vitest";
import type { SessionStatus } from "@wayfinder/domain";
import {
  RECENT_CHATS_LIMIT,
  formatRecentChatMeta,
  isNewChatShortcut,
  recentChatSessions,
  recentChatStatusLabel,
  relativeAge,
  resolveActiveHref,
} from "./sidebar-model";

const NOW = new Date("2026-08-05T12:00:00Z");
const ago = (milliseconds: number) => new Date(NOW.getTime() - milliseconds);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relativeAge", () => {
  it("reads as 'just now' under a minute", () => {
    expect(relativeAge(ago(30_000), NOW)).toBe("just now");
  });

  it("counts minutes below the hour", () => {
    expect(relativeAge(ago(17 * MINUTE), NOW)).toBe("17m ago");
  });

  it("counts hours below the day, matching the design mockup's '17h ago'", () => {
    expect(relativeAge(ago(17 * HOUR), NOW)).toBe("17h ago");
  });

  it("drops 'ago' past a day, matching the mockup's '3d' and '6d'", () => {
    expect(relativeAge(ago(3 * DAY), NOW)).toBe("3d");
    expect(relativeAge(ago(6 * DAY), NOW)).toBe("6d");
  });

  it("switches to weeks rather than growing an unbounded day count", () => {
    expect(relativeAge(ago(14 * DAY), NOW)).toBe("2w");
  });

  it("treats a future timestamp as now rather than emitting a negative age", () => {
    expect(relativeAge(new Date(NOW.getTime() + HOUR), NOW)).toBe("just now");
  });
});

describe("recentChatStatusLabel", () => {
  it("maps each session status to the rail's wording", () => {
    expect(recentChatStatusLabel("active")).toBe("In progress");
    expect(recentChatStatusLabel("complete")).toBe("Done");
    expect(recentChatStatusLabel("abandoned")).toBe("Abandoned");
    expect(recentChatStatusLabel("cancelled")).toBe("Cancelled");
  });
});

describe("formatRecentChatMeta", () => {
  it("joins status and age with the mockup's separator", () => {
    expect(formatRecentChatMeta("complete", ago(17 * HOUR), NOW)).toBe("Done · 17h ago");
    expect(formatRecentChatMeta("active", ago(3 * DAY), NOW)).toBe("In progress · 3d");
  });
});

// The rail renders a ⌘K hint next to New chat. A hint that does nothing is a
// lie to the user, so the binding is real — and must not fire while the user is
// typing a K into a field.
describe("isNewChatShortcut", () => {
  const event = (over: Partial<Parameters<typeof isNewChatShortcut>[0]> = {}) => ({
    key: "k",
    metaKey: true,
    ctrlKey: false,
    target: null,
    ...over,
  });

  it("fires on meta+K and ctrl+K", () => {
    expect(isNewChatShortcut(event())).toBe(true);
    expect(isNewChatShortcut(event({ metaKey: false, ctrlKey: true }))).toBe(true);
  });

  it("is case-insensitive, so shift+⌘+K still counts", () => {
    expect(isNewChatShortcut(event({ key: "K" }))).toBe(true);
  });

  it("ignores a bare K", () => {
    expect(isNewChatShortcut(event({ metaKey: false, ctrlKey: false }))).toBe(false);
  });

  it("ignores other modified keys", () => {
    expect(isNewChatShortcut(event({ key: "j" }))).toBe(false);
  });

  // Autofill, password managers and IME composition can dispatch keydown events
  // with no key at all — those must be ignored, not crash the handler.
  it("ignores a keydown with no key", () => {
    expect(isNewChatShortcut(event({ key: undefined }))).toBe(false);
  });

  it("does not fire while an input, textarea or editable element has focus", () => {
    expect(isNewChatShortcut(event({ target: { tagName: "INPUT" } }))).toBe(false);
    expect(isNewChatShortcut(event({ target: { tagName: "TEXTAREA" } }))).toBe(false);
    expect(isNewChatShortcut(event({ target: { tagName: "DIV", isContentEditable: true } }))).toBe(
      false,
    );
  });

  it("still fires when focus is on a non-editable element", () => {
    expect(isNewChatShortcut(event({ target: { tagName: "DIV" } }))).toBe(true);
  });
});

describe("resolveActiveHref", () => {
  const NAV = ["/chats", "/flows", "/approvals", "/synthesise"];

  it("activates the chat itself, not its parent, on a chat detail route", () => {
    // The reported defect: /chats and /chats/<id> both highlighted, so the rail
    // claimed the user was in two places at once.
    const candidates = [...NAV, "/chats/abc"];
    expect(resolveActiveHref("/chats/abc", candidates)).toBe("/chats/abc");
  });

  it("activates the parent when no more specific candidate exists", () => {
    // A chat not in the recent list still has to light *something* up.
    expect(resolveActiveHref("/chats/unlisted", NAV)).toBe("/chats");
  });

  it("prefers an exact match over any prefix", () => {
    expect(resolveActiveHref("/chats", [...NAV, "/chats/abc"])).toBe("/chats");
  });

  it("returns null when nothing matches", () => {
    expect(resolveActiveHref("/settings", NAV)).toBeNull();
  });

  it("does not treat a shared name prefix as a parent", () => {
    // "/chat" must not claim "/chats" — the boundary is a path segment, not a
    // string prefix.
    expect(resolveActiveHref("/chats", ["/chat"])).toBeNull();
  });

  it("never lets a bare root swallow every route", () => {
    expect(resolveActiveHref("/chats/abc", ["/", "/chats"])).toBe("/chats");
  });

  it("picks the longest of several matching ancestors", () => {
    const candidates = ["/admin", "/admin/flows", "/admin/flows/nested"];
    expect(resolveActiveHref("/admin/flows/nested/deep", candidates)).toBe("/admin/flows/nested");
  });
});

describe("recentChatSessions", () => {
  const chat = (id: string, status: SessionStatus = "active") => ({ id, status });

  it("caps the list so the rail cannot grow without bound", () => {
    const sessions = Array.from({ length: RECENT_CHATS_LIMIT + 5 }, (_, index) =>
      chat(`s${index}`),
    );

    expect(recentChatSessions(sessions)).toHaveLength(RECENT_CHATS_LIMIT);
  });

  it("returns a shorter list whole", () => {
    expect(recentChatSessions([chat("s1"), chat("s2")]).map((session) => session.id)).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("keeps the order it was given, which is the order the rail shows", () => {
    const sessions = [chat("newest"), chat("older"), chat("oldest")];

    expect(recentChatSessions(sessions).map((session) => session.id)).toEqual([
      "newest",
      "older",
      "oldest",
    ]);
  });

  it("leaves out abandoned chats", () => {
    const sessions = [chat("kept", "active"), chat("dropped", "abandoned")];

    expect(recentChatSessions(sessions).map((session) => session.id)).toEqual(["kept"]);
  });

  it("counts the cap after abandoned chats are dropped, not before", () => {
    // Filtering second would let a run of abandoned chats eat the cap and leave
    // the rail showing two entries when the user has plenty.
    const sessions = [
      ...Array.from({ length: RECENT_CHATS_LIMIT }, (_, index) =>
        chat(`abandoned-${index}`, "abandoned"),
      ),
      chat("live"),
    ];

    expect(recentChatSessions(sessions).map((session) => session.id)).toEqual(["live"]);
  });

  it("handles an empty list", () => {
    expect(recentChatSessions([])).toEqual([]);
  });
});
