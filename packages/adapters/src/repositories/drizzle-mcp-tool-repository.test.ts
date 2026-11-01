import { describe, expect, it } from "vitest";
import { planToolReplacement, toCachedMcpTool, type McpToolRow } from "./drizzle-mcp-tool-repository";

const row = (overrides: Partial<McpToolRow> = {}): McpToolRow => ({
  id: "tool-row-1",
  server_id: "mcp-1",
  name: "search",
  title: "Search",
  description: "Searches",
  input_schema: { type: "object" },
  pagination_config: null,
  status_config: null,
  citation_config: null,
  last_synced_at: new Date("2026-10-01"),
  created_at: new Date("2026-10-01"),
  updated_at: new Date("2026-10-01"),
  ...overrides,
});

describe("toCachedMcpTool", () => {
  it("maps the cached listing and the admin settings", () => {
    const pagination = { cursorArgument: "cursor", nextCursorPath: "next", itemsPath: "items", maxPages: 3 };
    expect(toCachedMcpTool(row({ pagination_config: pagination }))).toEqual({
      serverId: "mcp-1",
      name: "search",
      title: "Search",
      description: "Searches",
      inputSchema: { type: "object" },
      pagination,
      status: null,
      citation: null,
      lastSyncedAt: new Date("2026-10-01"),
    });
  });
});

describe("planToolReplacement", () => {
  it("removes tools the server stopped listing and upserts the rest by name", () => {
    const plan = planToolReplacement(
      [row({ name: "search" }), row({ id: "tool-row-2", name: "retired" })],
      [
        { name: "search", title: "Search v2", description: null, inputSchema: null },
        { name: "fetch", title: null, description: null, inputSchema: null },
      ],
    );

    expect(plan.removeIds).toEqual(["tool-row-2"]);
    expect(plan.upserts.map((tool) => tool.name)).toEqual(["search", "fetch"]);
  });
});
