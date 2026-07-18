import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalAuditString,
  computeAuditHash,
  verifyAuditChain,
  type AuditHashInput,
  type ChainedAuditRow,
} from "./audit-hash";

// Real SHA-256 stands in for the adapter's injected primitive. Test files are
// exempt from the domain purity check, so node:crypto is fine here.
const sha256Hex = (input: string): string => createHash("sha256").update(input, "utf8").digest("hex");

const baseInput: AuditHashInput = {
  actorId: "user-1",
  action: "role.changed",
  resourceType: "user",
  resourceId: "user-2",
  metadata: { from: "member", to: "admin" },
  createdAt: new Date("2026-06-01T12:00:00.000Z"),
  sequence: 1,
};

describe("canonicalAuditString", () => {
  it("is stable regardless of metadata key order", () => {
    const a = canonicalAuditString({ ...baseInput, metadata: { from: "member", to: "admin" } });
    const b = canonicalAuditString({ ...baseInput, metadata: { to: "admin", from: "member" } });
    expect(a).toBe(b);
  });

  it("sorts nested metadata keys too", () => {
    const a = canonicalAuditString({ ...baseInput, metadata: { outer: { a: 1, b: 2 } } });
    const b = canonicalAuditString({ ...baseInput, metadata: { outer: { b: 2, a: 1 } } });
    expect(a).toBe(b);
  });

  it("changes when any hashed field changes", () => {
    const original = canonicalAuditString(baseInput);
    expect(canonicalAuditString({ ...baseInput, action: "role.removed" })).not.toBe(original);
    expect(canonicalAuditString({ ...baseInput, resourceId: "user-9" })).not.toBe(original);
    expect(canonicalAuditString({ ...baseInput, sequence: 2 })).not.toBe(original);
  });

  it("distinguishes null metadata from an empty object", () => {
    expect(canonicalAuditString({ ...baseInput, metadata: null })).not.toBe(
      canonicalAuditString({ ...baseInput, metadata: {} }),
    );
  });
});

describe("computeAuditHash", () => {
  it("binds the previous hash into the result", () => {
    const withGenesis = computeAuditHash(baseInput, null, sha256Hex);
    const withPrev = computeAuditHash(baseInput, "abc123", sha256Hex);
    expect(withGenesis).not.toBe(withPrev);
  });

  it("is deterministic for the same input and previous hash", () => {
    expect(computeAuditHash(baseInput, "prev", sha256Hex)).toBe(
      computeAuditHash(baseInput, "prev", sha256Hex),
    );
  });
});

const chainedRow = (input: AuditHashInput, prevHash: string | null): ChainedAuditRow => ({
  ...input,
  prevHash,
  hash: computeAuditHash(input, prevHash, sha256Hex),
});

const firstRow = chainedRow({ ...baseInput, sequence: 1 }, null);
const secondRow = chainedRow(
  { ...baseInput, sequence: 2, action: "flow.published", metadata: { flowId: "flow-1" } },
  firstRow.hash,
);
const thirdRow = chainedRow(
  { ...baseInput, sequence: 3, action: "session.completed" },
  secondRow.hash,
);

describe("verifyAuditChain", () => {
  it("returns null for an intact chain", () => {
    expect(verifyAuditChain([firstRow, secondRow], sha256Hex)).toBeNull();
  });

  it("detects a row whose field was altered", () => {
    const tampered = { ...secondRow, action: "flow.deleted" };
    const result = verifyAuditChain([firstRow, tampered], sha256Hex);
    expect(result?.sequence).toBe(2);
    expect(result?.reason).toBe("hash_mismatch");
  });

  it("detects a deleted row via a broken prev-hash link", () => {
    // Drop the middle row: the third row's prevHash no longer matches its new predecessor.
    const result = verifyAuditChain([firstRow, thirdRow], sha256Hex);
    expect(result?.sequence).toBe(3);
    expect(result?.reason).toBe("prev_hash_mismatch");
  });

  it("verifies rows given out of order by sorting on sequence", () => {
    expect(verifyAuditChain([secondRow, firstRow], sha256Hex)).toBeNull();
  });
});
