import { describe, expect, it } from "vitest";
import { shouldStartNavigation, type NavigationClickIntent } from "./navigation-progress-intent";

const baseIntent: NavigationClickIntent = {
  href: "/flows",
  target: null,
  hasDownload: false,
  currentHref: "https://app.example.com/chats",
  isModified: false,
};

describe("shouldStartNavigation", () => {
  it("starts for a plain same-origin link to a different path", () => {
    expect(shouldStartNavigation(baseIntent)).toBe(true);
  });

  it("starts for a relative href resolved against the current page", () => {
    expect(
      shouldStartNavigation({ ...baseIntent, href: "/chats/abc", currentHref: "https://app.example.com/chats" }),
    ).toBe(true);
  });

  it("does not start when the click is modified (cmd/ctrl/middle button)", () => {
    expect(shouldStartNavigation({ ...baseIntent, isModified: true })).toBe(false);
  });

  it("does not start for downloads", () => {
    expect(shouldStartNavigation({ ...baseIntent, hasDownload: true })).toBe(false);
  });

  it("does not start when there is no href", () => {
    expect(shouldStartNavigation({ ...baseIntent, href: null })).toBe(false);
  });

  it("does not start for links that open in a new tab", () => {
    expect(shouldStartNavigation({ ...baseIntent, target: "_blank" })).toBe(false);
  });

  it("starts for an explicit same-frame target", () => {
    expect(shouldStartNavigation({ ...baseIntent, target: "_self" })).toBe(true);
  });

  it("does not start for external origins", () => {
    expect(shouldStartNavigation({ ...baseIntent, href: "https://github.com/rbrasier/wayfinder" })).toBe(false);
  });

  it("does not start when navigating to the same path and query", () => {
    expect(
      shouldStartNavigation({ ...baseIntent, href: "/chats", currentHref: "https://app.example.com/chats" }),
    ).toBe(false);
  });

  it("does not start for a hash-only change on the same page", () => {
    expect(
      shouldStartNavigation({ ...baseIntent, href: "/chats#section", currentHref: "https://app.example.com/chats" }),
    ).toBe(false);
  });

  it("starts when only the query string differs", () => {
    expect(
      shouldStartNavigation({ ...baseIntent, href: "/chats?tab=done", currentHref: "https://app.example.com/chats" }),
    ).toBe(true);
  });
});
