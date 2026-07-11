import { describe, expect, it } from "vitest";
import { SkillParser } from "./skill-parser";

const parser = new SkillParser();

describe("SkillParser", () => {
  it("parses name, description and body from frontmatter", () => {
    const raw = [
      "---",
      "name: Contract Reviewer",
      "description: Reviews procurement contracts for risk",
      "---",
      "",
      "# Contract review",
      "Read the contract carefully and flag unusual clauses.",
    ].join("\n");

    const result = parser.parse(raw);

    expect(result.error).toBeUndefined();
    expect(result.data?.name).toBe("Contract Reviewer");
    expect(result.data?.description).toBe("Reviews procurement contracts for risk");
    expect(result.data?.body).toContain("Read the contract carefully");
    expect(result.data?.allowedTools).toEqual([]);
  });

  it("parses allowed-tools as an inline array", () => {
    const raw = [
      "---",
      "name: Researcher",
      "allowed-tools: [search, fetch_page]",
      "---",
      "Do research.",
    ].join("\n");

    const result = parser.parse(raw);

    expect(result.data?.allowedTools).toEqual(["search", "fetch_page"]);
  });

  it("parses allowed-tools as a block list", () => {
    const raw = [
      "---",
      "name: Researcher",
      "allowed-tools:",
      "  - search",
      "  - fetch_page",
      "---",
      "Do research.",
    ].join("\n");

    const result = parser.parse(raw);

    expect(result.data?.allowedTools).toEqual(["search", "fetch_page"]);
  });

  it("strips surrounding quotes from frontmatter values", () => {
    const raw = ['---', 'name: "Quoted Name"', "---", "Body."].join("\n");

    const result = parser.parse(raw);

    expect(result.data?.name).toBe("Quoted Name");
  });

  it("falls back to the first markdown heading when no name is declared", () => {
    const raw = ["# Fallback Skill", "", "Some instructions."].join("\n");

    const result = parser.parse(raw);

    expect(result.data?.name).toBe("Fallback Skill");
    expect(result.data?.body).toContain("Some instructions.");
  });

  it("returns VALIDATION_FAILED for an empty file", () => {
    const result = parser.parse("   \n  ");

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("returns VALIDATION_FAILED when no name can be derived", () => {
    const raw = ["---", "description: no name here", "---", "Body text."].join("\n");

    const result = parser.parse(raw);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("returns VALIDATION_FAILED when the body is empty", () => {
    const raw = ["---", "name: Empty Body", "---", "   "].join("\n");

    const result = parser.parse(raw);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});
