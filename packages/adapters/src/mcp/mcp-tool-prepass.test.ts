import type { ToolSet } from "ai";
import { describe, expect, it } from "vitest";
import { extractToolCalls, prefixToolName, selectAllowedTools } from "./mcp-tool-prepass";

// The tool objects are opaque to selection — only the keys matter — so a stub
// shape cast to ToolSet exercises the deny-by-default rule without a live server.
const stubTools = {
  search: {},
  fetch_page: {},
  delete_everything: {},
} as unknown as ToolSet;

describe("selectAllowedTools", () => {
  it("keeps only the allow-listed tools", () => {
    const selected = selectAllowedTools(stubTools, ["search", "fetch_page"]);
    expect(Object.keys(selected).sort()).toEqual(["fetch_page", "search"]);
  });

  it("never assembles a tool that is not allow-listed", () => {
    const selected = selectAllowedTools(stubTools, ["search"]);
    expect(selected.delete_everything).toBeUndefined();
  });

  it("returns an empty set when nothing is allowed", () => {
    expect(Object.keys(selectAllowedTools(stubTools, []))).toHaveLength(0);
  });

  it("ignores allow-listed names the server does not expose", () => {
    const selected = selectAllowedTools(stubTools, ["search", "nonexistent"]);
    expect(Object.keys(selected)).toEqual(["search"]);
  });
});

describe("prefixToolName", () => {
  it("namespaces a tool under its server label", () => {
    expect(prefixToolName("Docs Search", "query")).toBe("Docs_Search__query");
  });

  it("gives two servers exposing the same tool distinct keys", () => {
    expect(prefixToolName("Alpha", "search")).not.toBe(prefixToolName("Beta", "search"));
  });

  it("falls back to a stable prefix when the label has no usable characters", () => {
    expect(prefixToolName("***", "run")).toBe("server__run");
  });
});

describe("extractToolCalls", () => {
  const origins = new Map([
    ["Alpha__search", { serverLabel: "Alpha", toolName: "search" }],
  ]);
  const now = () => new Date("2026-07-13T00:00:00.000Z");

  it("pairs a call with its result via the call id and resolves the origin", () => {
    const steps = [
      {
        toolCalls: [{ toolCallId: "c1", toolName: "Alpha__search", args: { q: "hello" } }],
        toolResults: [{ toolCallId: "c1", result: { hits: 2 } }],
      },
    ];
    const records = extractToolCalls(steps, origins, now);
    expect(records).toEqual([
      {
        serverLabel: "Alpha",
        toolName: "search",
        arguments: JSON.stringify({ q: "hello" }),
        result: JSON.stringify({ hits: 2 }),
        calledAt: "2026-07-13T00:00:00.000Z",
      },
    ]);
  });

  it("records an empty result when no matching tool result is present", () => {
    const steps = [
      {
        toolCalls: [{ toolCallId: "c9", toolName: "Alpha__search", args: {} }],
        toolResults: [],
      },
    ];
    expect(extractToolCalls(steps, origins, now)[0]?.result).toBe("");
  });
});
