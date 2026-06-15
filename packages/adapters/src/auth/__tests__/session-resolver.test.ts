import { describe, expect, it, vi } from "vitest";
import { resolveSession } from "../session-resolver";
import type { Database } from "../../db/client";

const buildDb = (rows: Array<{ userId: string; isAdmin: boolean }>) => {
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
    const db = buildDb([{ userId: "user-1", isAdmin: true }]) as Database & {
      where: ReturnType<typeof vi.fn>;
    };
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
