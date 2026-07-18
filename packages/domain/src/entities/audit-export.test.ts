import { describe, expect, it } from "vitest";
import type { AuditLog } from "./audit-log";
import { toAuditCsv, toAuditJson } from "./audit-export";

const row = (overrides: Partial<AuditLog>): AuditLog => ({
  id: "a1",
  actorId: "user-1",
  action: "role.changed",
  resourceType: "user",
  resourceId: "user-2",
  metadata: { from: "member", to: "admin" },
  createdAt: new Date("2026-06-01T12:00:00.000Z"),
  sequence: 1,
  prevHash: null,
  hash: "h1",
  ...overrides,
});

describe("toAuditCsv", () => {
  it("emits a header row followed by one line per record", () => {
    const csv = toAuditCsv([row({}), row({ id: "a2", sequence: 2 })]);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      "id,sequence,created_at,actor_id,action,resource_type,resource_id,metadata",
    );
  });

  it("escapes commas, quotes, and newlines in a value", () => {
    const csv = toAuditCsv([row({ action: 'a,b"c\nd' })]);
    expect(csv).toContain('"a,b""c\nd"');
  });

  it("renders null values as empty fields", () => {
    const csv = toAuditCsv([row({ actorId: null, resourceId: null, metadata: null })]);
    const dataLine = csv.trim().split("\n")[1];
    expect(dataLine).toBe("a1,1,2026-06-01T12:00:00.000Z,,role.changed,user,,");
  });
});

describe("toAuditJson", () => {
  it("serialises rows with ISO timestamps", () => {
    const parsed = JSON.parse(toAuditJson([row({})])) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    const [first] = parsed;
    expect(first?.createdAt).toBe("2026-06-01T12:00:00.000Z");
    expect(first?.action).toBe("role.changed");
  });
});
