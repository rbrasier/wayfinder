import { describe, expect, it } from "vitest";
import {
  VERBATIM_SCOPE_NOTE,
  verbatimBadge,
  verbatimConfirmPrompt,
} from "./verbatim-toggle-model";

describe("verbatimConfirmPrompt", () => {
  it("asks before verbatim-only handling is turned on", () => {
    const prompt = verbatimConfirmPrompt("Rate table", true);
    expect(prompt).toContain("Rate table");
    expect(prompt.toLowerCase()).toContain("turn on");
  });

  it("asks before it is turned off, because removing a guarantee is the riskier half", () => {
    const prompt = verbatimConfirmPrompt("Rate table", false);
    expect(prompt).toContain("Rate table");
    expect(prompt.toLowerCase()).toContain("turn off");
  });

  it("describes what Wayfinder does, never whether the source is right", () => {
    const prompt = verbatimConfirmPrompt("Rate table", true).toLowerCase();
    expect(prompt).toContain("wayfinder");
    expect(prompt).not.toContain("accurate");
    expect(prompt).not.toContain("guarantee");
  });
});

describe("VERBATIM_SCOPE_NOTE", () => {
  it("states the limit of the guarantee rather than implying there is none", () => {
    const note = VERBATIM_SCOPE_NOTE.toLowerCase();
    expect(note).toContain("does not");
    expect(note).toContain("source");
  });
});

describe("verbatimBadge", () => {
  it("marks a governed connection", () => {
    expect(verbatimBadge(true)).toBe("Verbatim only");
  });

  it("shows nothing for a connection with no verbatim requirement", () => {
    expect(verbatimBadge(false)).toBeNull();
  });
});
