import { describe, expect, it, vi } from "vitest";
import {
  createSessionRevocationRegistry,
  revokeUserSessions,
} from "../session-revocation";
import type { Database } from "../../db/client";

const buildDb = (deletedIds: Array<{ id: string }>) => {
  const returning = vi.fn().mockResolvedValue(deletedIds);
  const where = vi.fn().mockReturnValue({ returning });
  const del = vi.fn().mockReturnValue({ where });
  return { db: { delete: del } as unknown as Database, del, where, returning };
};

describe("createSessionRevocationRegistry", () => {
  it("starts every user on the same epoch", () => {
    const registry = createSessionRevocationRegistry();

    expect(registry.epochFor("user-1")).toBe(registry.epochFor("user-2"));
  });

  it("moves a user to a new epoch when they are revoked", () => {
    const registry = createSessionRevocationRegistry();
    const before = registry.epochFor("user-1");

    registry.revoke("user-1");

    expect(registry.epochFor("user-1")).not.toBe(before);
  });

  it("leaves every other user's epoch untouched", () => {
    const registry = createSessionRevocationRegistry();
    const otherBefore = registry.epochFor("user-2");

    registry.revoke("user-1");

    // Revoking one leaver must not push every other signed-in user back to the
    // database — that is the cost the whole-cache-clear alternative carried.
    expect(registry.epochFor("user-2")).toBe(otherBefore);
  });
});

describe("revokeUserSessions", () => {
  it("deletes the user's sessions and reports how many ended", async () => {
    const { db, del, where } = buildDb([{ id: "session-1" }, { id: "session-2" }]);
    const registry = createSessionRevocationRegistry();

    const result = await revokeUserSessions(db, registry, "user-1");

    expect(result).toEqual({ data: 2 });
    expect(del).toHaveBeenCalledOnce();
    expect(where).toHaveBeenCalledOnce();
  });

  it("bumps the user's cache epoch so a cached principal stops resolving", async () => {
    const { db } = buildDb([{ id: "session-1" }]);
    const registry = createSessionRevocationRegistry();
    const before = registry.epochFor("user-1");

    await revokeUserSessions(db, registry, "user-1");

    expect(registry.epochFor("user-1")).not.toBe(before);
  });

  it("still bumps the epoch when the user held no sessions", async () => {
    const { db } = buildDb([]);
    const registry = createSessionRevocationRegistry();
    const before = registry.epochFor("user-1");

    const result = await revokeUserSessions(db, registry, "user-1");

    // A row could have been cached microseconds before the delete found nothing
    // to remove; the bump is what makes the outcome the same either way.
    expect(result).toEqual({ data: 0 });
    expect(registry.epochFor("user-1")).not.toBe(before);
  });

  it("returns an infrastructure error and leaves the epoch alone when the delete fails", async () => {
    const returning = vi.fn().mockRejectedValue(new Error("connection lost"));
    const where = vi.fn().mockReturnValue({ returning });
    const db = { delete: vi.fn().mockReturnValue({ where }) } as unknown as Database;
    const registry = createSessionRevocationRegistry();
    const before = registry.epochFor("user-1");

    const result = await revokeUserSessions(db, registry, "user-1");

    // Reporting success on a failed delete would tell an admin a leaver was cut
    // off when their sessions are still live.
    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(registry.epochFor("user-1")).toBe(before);
  });
});
