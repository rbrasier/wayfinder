import { describe, expect, it } from "vitest";
import { SettingsEncryptionService } from "../config/settings-encryption";
import { toMcpServerEntity, type McpServerRow } from "./drizzle-mcp-server-repository";

const encryption = new SettingsEncryptionService(Buffer.alloc(32, 7));

// The mapping is where an admin classification silently goes missing: the column
// exists, the entity member exists, and nothing fails to compile if the two are
// never connected. These lock the connection in.
const row = (overrides: Partial<McpServerRow> = {}): McpServerRow => ({
  id: "mcp-1",
  label: "Rate table",
  transport: "sse",
  url: "https://mcp.example.com/sse",
  data_classification: "internal",
  verbatim_only: false,
  call_timeout_ms: 30_000,
  credential_ciphertext: null,
  custom_headers_ciphertext: null,
  status: "active",
  created_by_user_id: null,
  created_at: new Date("2026-01-01"),
  updated_at: new Date("2026-01-01"),
  ...overrides,
});

describe("toMcpServerEntity", () => {
  it("carries the classification, timeout and verbatim-only handling onto the entity", () => {
    const entity = toMcpServerEntity(
      row({ data_classification: "public-read", call_timeout_ms: 45_000, verbatim_only: true }),
      encryption,
    );
    expect(entity).toMatchObject({ dataClassification: "public-read", callTimeoutMs: 45_000, verbatimOnly: true });
  });

  it("reports that secrets exist and names the headers without exposing any value", () => {
    const entity = toMcpServerEntity(
      row({
        credential_ciphertext: encryption.encrypt("token-1"),
        custom_headers_ciphertext: encryption.encrypt(JSON.stringify({ "X-Api-Key": "key-1" })),
      }),
      encryption,
    );

    expect(entity.hasCredential).toBe(true);
    expect(entity.customHeaderNames).toEqual(["X-Api-Key"]);
    expect(JSON.stringify(entity)).not.toContain("token-1");
    expect(JSON.stringify(entity)).not.toContain("key-1");
  });

  it("reads a server with no secrets as having none", () => {
    expect(toMcpServerEntity(row(), encryption)).toMatchObject({ hasCredential: false, customHeaderNames: [] });
  });

  it("reads undecryptable headers as none rather than failing the listing", () => {
    const entity = toMcpServerEntity(row({ custom_headers_ciphertext: "enc:v1:garbage" }), encryption);
    expect(entity.customHeaderNames).toEqual([]);
  });
});
