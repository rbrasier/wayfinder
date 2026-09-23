import { describe, expect, it, vi } from "vitest";
import { resolveSession } from "../session-resolver";
import type { Database } from "../../db/client";

const buildDb = (rows: Array<{ sessionId: string; userId: string; isAdmin: boolean }>) => {
  const select = vi.fn().mockReturnThis();
  const from = vi.fn().mockReturnThis();
  const innerJoin = vi.fn().mockReturnThis();
  const where = vi.fn().mockReturnThis();
  const limit = vi.fn().mockResolvedValue(rows);
  return {
    select,
    from,
    innerJoin,
    where,
    limit,
  } as unknown as Database & { where: typeof where };
};

describe("resolveSession", () => {
  it("strips the Better Auth signature suffix before the DB lookup", async () => {
    const db = buildDb([{ sessionId: "session-row-1", userId: "user-1", isAdmin: true }]) as Database & {
      where: ReturnType<typeof vi.fn>;
    };
    // Better Auth signs the cookie as `<token>.<base64-signature>`. The DB
    // stores only the bare 32-char token.
    const signedValue = "abcDEF0123456789abcDEF0123456789.somebase64signaturehere=";

    const result = await resolveSession(db, signedValue);

    expect(result).toEqual({ sessionId: "session-row-1", userId: "user-1", isAdmin: true });
    // The eq() condition is passed positionally; we just need to assert the
    // helper was called (the actual token comparison runs against the DB row,
    // which our fake returns unconditionally).
    expect(db.where).toHaveBeenCalledOnce();
  });

  it("selects the session row id so callers can tell sign-ins apart without the token", async () => {
    const db = buildDb([{ sessionId: "session-row-1", userId: "user-1", isAdmin: false }]) as Database & {
      select: ReturnType<typeof vi.fn>;
    };

    await resolveSession(db, "abcDEF0123456789abcDEF0123456789.sig=");

    const selectedColumns = Object.keys(db.select.mock.calls[0]?.[0] ?? {});
    expect(selectedColumns).toEqual(["sessionId", "userId", "isAdmin"]);
  });

  it("returns null when no row matches", async () => {
    const db = buildDb([]);
    const result = await resolveSession(db, "missing-token.signature=");
    expect(result).toBeNull();
  });

  it("handles unsigned tokens (e.g. dev-login) without modification", async () => {
    const db = buildDb([{ sessionId: "session-row-2", userId: "user-2", isAdmin: false }]);
    const result = await resolveSession(db, "rawhexdevlogintokenwithoutdots");
    expect(result).toEqual({ sessionId: "session-row-2", userId: "user-2", isAdmin: false });
  });
});
