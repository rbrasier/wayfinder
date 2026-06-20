import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTACT_FORM_URL,
  GITHUB_ISSUES_URL,
  HelpMenu,
  resolveContactFormUrl,
} from "./help-menu";

describe("HelpMenu", () => {
  it("exports a function component", () => {
    expect(typeof HelpMenu).toBe("function");
  });

  it("component name is HelpMenu", () => {
    expect(HelpMenu.name).toBe("HelpMenu");
  });
});

describe("resolveContactFormUrl", () => {
  it("falls back to the default Google Form when no override is set", () => {
    expect(resolveContactFormUrl(undefined)).toBe(DEFAULT_CONTACT_FORM_URL);
    expect(resolveContactFormUrl("")).toBe(DEFAULT_CONTACT_FORM_URL);
    expect(resolveContactFormUrl("   ")).toBe(DEFAULT_CONTACT_FORM_URL);
  });

  it("uses the env override when provided", () => {
    expect(resolveContactFormUrl("https://forms.gle/custom123")).toBe("https://forms.gle/custom123");
  });

  it("trims surrounding whitespace from the override", () => {
    expect(resolveContactFormUrl("  https://example.com/form  ")).toBe("https://example.com/form");
  });
});

describe("GITHUB_ISSUES_URL", () => {
  it("points at the wayfinder issues page", () => {
    expect(GITHUB_ISSUES_URL).toBe("https://github.com/rbrasier/wayfinder/issues");
  });
});
