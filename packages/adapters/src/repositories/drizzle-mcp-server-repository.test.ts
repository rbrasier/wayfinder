import { describe, expect, it } from "vitest";
import { toMcpServerEntity, type McpServerRow } from "./drizzle-mcp-server-repository";

// The mapping is where an admin classification silently goes missing: the column
// exists, the entity member exists, and nothing fails to compile if the two are
// never connected. These lock the connection in.
const row = (overrides: Partial<McpServerRow> = {}): McpServerRow => ({
  id: "mcp-1",
  label: "Rate table",
  transport: "sse",
  url: "https://mcp.example.com/sse",
  credential_ref: null,
  communicates_externally: false,
  verbatim_only: false,
  status: "active",
  created_by_user_id: null,
  created_at: new Date("2026-01-01"),
  updated_at: new Date("2026-01-01"),
  ...overrides,
});

describe("toMcpServerEntity", () => {
  it("carries the verbatim-only classification onto the entity", () => {
    expect(toMcpServerEntity(row({ verbatim_only: true })).verbatimOnly).toBe(true);
  });

  it("reads a connection registered before the column existed as not verbatim-only", () => {
    // The migration defaults the column, so every pre-existing row arrives false
    // and keeps the behaviour it had.
    expect(toMcpServerEntity(row()).verbatimOnly).toBe(false);
  });

  it("keeps the two admin classifications independent of each other", () => {
    const entity = toMcpServerEntity(row({ communicates_externally: true, verbatim_only: false }));
    expect(entity.communicatesExternally).toBe(true);
    expect(entity.verbatimOnly).toBe(false);
  });
});
