import { describe, expect, it } from "vitest";
import type { McpToolCallRecord, ToolRecordCitation } from "@wayfinder/domain";
import { citedSourcesFor, renderToolResults, TOOL_RESULTS_PROMPT_BUDGET_CHARS } from "./mcp-turn-helpers";

const citation = (locator: string, overrides: Partial<ToolRecordCitation> = {}): ToolRecordCitation => ({
  serverId: "mcp-1",
  serverLabel: "Legislation",
  toolName: "search",
  locator,
  title: `Act ${locator}`,
  url: `https://legislation.example/${locator}`,
  recordedAt: null,
  ...overrides,
});

const record = (overrides: Partial<McpToolCallRecord> = {}): McpToolCallRecord => ({
  serverLabel: "Legislation",
  toolName: "search",
  arguments: "{}",
  result: "Water Act text",
  calledAt: "2026-10-17T00:00:00.000Z",
  ...overrides,
});

describe("renderToolResults", () => {
  it("numbers each source record and lists it under the call that found it", () => {
    const rendered = renderToolResults([
      record({ citations: [citation("a"), citation("b")] }),
      record({ toolName: "lookup", result: "Fire Act text", citations: [citation("c", { url: null })] }),
    ]);

    expect(rendered.numbered.map((entry) => entry.marker)).toEqual(["S1", "S2", "S3"]);
    expect(rendered.text).toContain("- search (Legislation): Water Act text");
    expect(rendered.text).toContain("[S1] Act a — a (https://legislation.example/a)");
    expect(rendered.text).toContain("[S3] Act c — c");
    expect(rendered.text).toContain("cite it with its marker");
  });

  it("gives a record found twice one marker", () => {
    const rendered = renderToolResults([record({ citations: [citation("a")] }), record({ citations: [citation("a")] })]);

    expect(rendered.numbered).toHaveLength(1);
  });

  it("renders a legacy record with no citations, and no citation instruction when nothing can be cited", () => {
    const rendered = renderToolResults([record()]);

    expect(rendered.text).toBe("- search (Legislation): Water Act text");
    expect(rendered.numbered).toEqual([]);
  });

  it("re-injects a large earlier result whole while it fits the budget", () => {
    const large = "z".repeat(50_000);
    const rendered = renderToolResults([record({ result: large })]);

    expect(rendered.text).toContain(large);
    expect(rendered.text).not.toContain("omitted");
  });

  it("cuts the oldest results first past the budget, and says how much was left out", () => {
    const oldest = "o".repeat(TOOL_RESULTS_PROMPT_BUDGET_CHARS);
    const newest = "n".repeat(1_000);
    const rendered = renderToolResults([record({ result: oldest }), record({ result: newest })]);

    expect(rendered.text).toContain(newest);
    expect(rendered.text).toContain("[1000 characters omitted — call the tool again for the full result]");
  });

  it("notes a result that was already cut when it was stored", () => {
    const rendered = renderToolResults([record({ truncated: true })]);

    expect(rendered.text).toContain("stored result was cut");
  });
});

describe("citedSourcesFor", () => {
  it("keeps only the records the reply cited", () => {
    const { numbered } = renderToolResults([record({ citations: [citation("a"), citation("b")] })]);

    expect(citedSourcesFor("The Act [S2] applies.", numbered)).toEqual([{ ...citation("b"), marker: "S2" }]);
  });

  it("returns undefined when the reply cited nothing, so the payload carries no empty member", () => {
    expect(citedSourcesFor("No markers.", [])).toBeUndefined();
  });
});
