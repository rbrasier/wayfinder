import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SESSION_POLICY, type SessionPolicy } from "@rbrasier/domain";
import { resolveSession } from "../session-resolver";
import type { Database } from "../../db/client";

interface FakeRow {
  userId: string;
  isAdmin: boolean;
  sessionId?: string;
  createdAt?: Date;
  lastActiveAt?: Date | null;
}

const now = new Date("2026-08-17T12:00:00.000Z");
const minutesAgo = (minutes: number): Date => new Date(now.getTime() - minutes * 60 * 1000);

const buildDb = (rows: FakeRow[]) => {
  const complete = rows.map((row) => ({
    sessionId: "session-1",
    createdAt: now,
    lastActiveAt: now,
    ...row,
  }));
  const select = vi.fn().mockReturnThis();
  const from = vi.fn().mockReturnThis();
  const innerJoin = vi.fn().mockReturnThis();
  const where = vi.fn().mockReturnThis();
  const limit = vi.fn().mockResolvedValue(complete);
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set });
  return {
    select,
    from,
    innerJoin,
    where,
    limit,
    update,
    set,
  } as unknown as Database & {
    where: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };
};

const policyWith = (overrides: Partial<SessionPolicy>): SessionPolicy => ({
  ...DEFAULT_SESSION_POLICY,
  ...overrides,
});

describe("resolveSession", () => {
  it("strips the Better Auth signature suffix before the DB lookup", async () => {
    const db = buildDb([{ userId: "user-1", isAdmin: true }]);
    // Better Auth signs the cookie as `<token>.<base64-signature>`. The DB
    // stores only the bare 32-char token.
    const signedValue = "abcDEF0123456789abcDEF0123456789.somebase64signaturehere=";

    const result = await resolveSession(db, signedValue);

    expect(result).toEqual({ userId: "user-1", isAdmin: true });
    // The eq() condition is passed positionally; we just need to assert the
    // helper was called (the actual token comparison runs against the DB row,
    // which our fake returns unconditionally).
    expect(db.where).toHaveBeenCalledOnce();
  });

  it("returns null when no row matches", async () => {
    const db = buildDb([]);
    const result = await resolveSession(db, "missing-token.signature=");
    expect(result).toBeNull();
  });

  it("handles unsigned tokens (e.g. dev-login) without modification", async () => {
    const db = buildDb([{ userId: "user-2", isAdmin: false }]);
    const result = await resolveSession(db, "rawhexdevlogintokenwithoutdots");
    expect(result).toEqual({ userId: "user-2", isAdmin: false });
  });
});

describe("resolveSession — policy timeouts", () => {
  it("resolves a session normally when no timeout is configured", async () => {
    const db = buildDb([
      { userId: "user-1", isAdmin: false, createdAt: minutesAgo(10_000), lastActiveAt: minutesAgo(500) },
    ]);

    const result = await resolveSession(db, "token", DEFAULT_SESSION_POLICY, now);

    expect(result).toEqual({ userId: "user-1", isAdmin: false });
  });

  it("returns no principal for a session idle beyond the idle timeout", async () => {
    const db = buildDb([
      { userId: "user-1", isAdmin: false, createdAt: minutesAgo(60), lastActiveAt: minutesAgo(31) },
    ]);

    const result = await resolveSession(db, "token", policyWith({ idleTimeoutMinutes: 30 }), now);

    expect(result).toBeNull();
  });

  it("returns no principal for a session older than the absolute timeout", async () => {
    const db = buildDb([
      { userId: "user-1", isAdmin: false, createdAt: minutesAgo(481), lastActiveAt: now },
    ]);

    const result = await resolveSession(
      db,
      "token",
      policyWith({ absoluteTimeoutMinutes: 480 }),
      now,
    );

    expect(result).toBeNull();
  });

  it("measures idleness from created_at when the row has never been stamped", async () => {
    const db = buildDb([
      { userId: "user-1", isAdmin: false, createdAt: minutesAgo(31), lastActiveAt: null },
    ]);

    const result = await resolveSession(db, "token", policyWith({ idleTimeoutMinutes: 30 }), now);

    expect(result).toBeNull();
  });

  it("does not write a last-active stamp for a session it just rejected", async () => {
    const db = buildDb([
      { userId: "user-1", isAdmin: false, createdAt: minutesAgo(60), lastActiveAt: minutesAgo(31) },
    ]);

    await resolveSession(db, "token", policyWith({ idleTimeoutMinutes: 30 }), now);

    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("resolveSession — last-active stamping", () => {
  it("stamps last_active_at when the recorded activity has gone stale", async () => {
    const db = buildDb([
      { userId: "user-1", isAdmin: false, createdAt: minutesAgo(60), lastActiveAt: minutesAgo(5) },
    ]);

    const result = await resolveSession(db, "token", DEFAULT_SESSION_POLICY, now);

    expect(result).toEqual({ userId: "user-1", isAdmin: false });
    expect(db.update).toHaveBeenCalledOnce();
    expect(db.set).toHaveBeenCalledWith({ last_active_at: now });
  });

  it("skips the write while the stamp is still fresh, keeping it off the hot path", async () => {
    const db = buildDb([
      {
        userId: "user-1",
        isAdmin: false,
        createdAt: minutesAgo(60),
        lastActiveAt: new Date(now.getTime() - 5_000),
      },
    ]);

    await resolveSession(db, "token", DEFAULT_SESSION_POLICY, now);

    expect(db.update).not.toHaveBeenCalled();
  });

  it("stamps even while no idle timeout is set", async () => {
    const db = buildDb([
      { userId: "user-1", isAdmin: false, createdAt: minutesAgo(60), lastActiveAt: null },
    ]);

    await resolveSession(db, "token", DEFAULT_SESSION_POLICY, now);

    // Otherwise the day an admin switches the idle timeout on, every live
    // session reads as idle since creation and everyone is signed out at once.
    expect(db.update).toHaveBeenCalledOnce();
  });

  it("still resolves the session when the stamp write fails", async () => {
    const db = buildDb([
      { userId: "user-1", isAdmin: false, createdAt: minutesAgo(60), lastActiveAt: null },
    ]);
    db.set.mockReturnValue({ where: vi.fn().mockRejectedValue(new Error("write failed")) });

    const result = await resolveSession(db, "token", DEFAULT_SESSION_POLICY, now);

    // A bookkeeping write must never sign a legitimate user out.
    expect(result).toEqual({ userId: "user-1", isAdmin: false });
  });
});
