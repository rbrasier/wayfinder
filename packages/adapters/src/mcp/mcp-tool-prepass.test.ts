import type { ToolSet } from "ai";
import { describe, expect, it } from "vitest";
import { selectAllowedTools } from "./mcp-tool-prepass";

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
