import { describe, expect, it } from "vitest";
import {
  activeHolds,
  hasGlobalHold,
  heldSessionIds,
  isHoldActive,
  isRowCoveredByHold,
  type LegalHold,
} from "./legal-hold";

const hold = (overrides: Partial<LegalHold>): LegalHold => ({
  id: "hold-1",
  name: "Matter 42",
  reason: null,
  createdBy: "user-1",
  scope: { kind: "global" },
  releasedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  ...overrides,
});

describe("isHoldActive", () => {
  it("is active when not released", () => {
    expect(isHoldActive(hold({ releasedAt: null }))).toBe(true);
  });

  it("is inactive once released", () => {
    expect(isHoldActive(hold({ releasedAt: new Date() }))).toBe(false);
  });
});

describe("activeHolds", () => {
  it("keeps only unreleased holds", () => {
    const holds = [
      hold({ id: "a", releasedAt: null }),
      hold({ id: "b", releasedAt: new Date() }),
    ];
    expect(activeHolds(holds).map((held) => held.id)).toEqual(["a"]);
  });
});

describe("hasGlobalHold", () => {
  it("is true for an active global hold", () => {
    expect(hasGlobalHold([hold({ scope: { kind: "global" } })])).toBe(true);
  });

  it("ignores a released global hold", () => {
    expect(hasGlobalHold([hold({ scope: { kind: "global" }, releasedAt: new Date() })])).toBe(false);
  });

  it("is false when only session holds exist", () => {
    expect(hasGlobalHold([hold({ scope: { kind: "by_session", sessionId: "s-1" } })])).toBe(false);
  });
});

describe("heldSessionIds", () => {
  it("collects distinct session ids from active session holds", () => {
    const holds = [
      hold({ id: "a", scope: { kind: "by_session", sessionId: "s-1" } }),
      hold({ id: "b", scope: { kind: "by_session", sessionId: "s-2" } }),
      hold({ id: "c", scope: { kind: "by_session", sessionId: "s-1" } }),
      hold({ id: "d", scope: { kind: "by_session", sessionId: "s-3" }, releasedAt: new Date() }),
    ];
    expect(heldSessionIds(holds).sort()).toEqual(["s-1", "s-2"]);
  });
});

describe("isRowCoveredByHold", () => {
  it("covers every row under a global hold", () => {
    const holds = [hold({ scope: { kind: "global" } })];
    expect(isRowCoveredByHold(holds, { sessionId: null })).toBe(true);
    expect(isRowCoveredByHold(holds, { sessionId: "s-9" })).toBe(true);
  });

  it("covers only matching session rows under a session hold", () => {
    const holds = [hold({ scope: { kind: "by_session", sessionId: "s-1" } })];
    expect(isRowCoveredByHold(holds, { sessionId: "s-1" })).toBe(true);
    expect(isRowCoveredByHold(holds, { sessionId: "s-2" })).toBe(false);
    expect(isRowCoveredByHold(holds, { sessionId: null })).toBe(false);
  });

  it("covers nothing when all holds are released", () => {
    const holds = [hold({ scope: { kind: "global" }, releasedAt: new Date() })];
    expect(isRowCoveredByHold(holds, { sessionId: "s-1" })).toBe(false);
  });
});
