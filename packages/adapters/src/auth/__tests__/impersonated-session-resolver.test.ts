import { describe, expect, it, vi } from "vitest";
import { createImpersonationTicket, type ImpersonationTicket } from "@wayfinder/domain";
import { resolveImpersonation } from "../impersonated-session-resolver";
import { signImpersonationTicket } from "../impersonation-cookie";
import type { ResolvedSession } from "../session-resolver";
import type { Database } from "../../db/client";

const SECRET = "test-secret-please-do-not-reuse";
const ADMIN = "11111111-1111-1111-1111-111111111111";
const TARGET = "22222222-2222-2222-2222-222222222222";
const STRANGER = "33333333-3333-3333-3333-333333333333";
const NOW = new Date("2026-09-15T10:00:00.000Z");

const adminSession: ResolvedSession = { userId: ADMIN, isAdmin: true, impersonatorId: null };
const plainSession: ResolvedSession = { userId: ADMIN, isAdmin: false, impersonatorId: null };

const queryResult = (rows: () => Promise<unknown>) => {
  const build = () => rows();
  return { then: (...args: Parameters<Promise<unknown>["then"]>) => build().then(...args), limit: build };
};

// The resolver reads exactly one row: the target user's admin flag.
const buildDb = ({ targetIsAdmin = false, targetExists = true, failReads = false } = {}) => {
  const chain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn(() =>
      queryResult(async () => {
        if (failReads) throw new Error("connection lost");
        return targetExists ? [{ isAdmin: targetIsAdmin }] : [];
      }),
    ),
  };
  return { select: vi.fn().mockReturnValue(chain) } as unknown as Database;
};

const cookieFor = (ticket: ImpersonationTicket): string =>
  signImpersonationTicket(ticket, SECRET);

const liveTicket = createImpersonationTicket(
  { targetUserId: TARGET, impersonatorId: ADMIN },
  NOW,
).data!;

describe("resolveImpersonation", () => {
  it("returns the target as the principal when everything checks out", async () => {
    const resolved = await resolveImpersonation(
      buildDb(),
      adminSession,
      cookieFor(liveTicket),
      SECRET,
      NOW,
    );

    expect(resolved).toEqual({ userId: TARGET, isAdmin: false, impersonatorId: ADMIN });
  });

  it("carries the target's own admin flag, not the impersonator's", async () => {
    const resolved = await resolveImpersonation(
      buildDb({ targetIsAdmin: true }),
      adminSession,
      cookieFor(liveTicket),
      SECRET,
      NOW,
    );

    expect(resolved?.isAdmin).toBe(true);
    expect(resolved?.userId).toBe(TARGET);
  });

  it("returns null when there is no session at all — a ticket alone is never authentication", async () => {
    const resolved = await resolveImpersonation(
      buildDb(),
      null,
      cookieFor(liveTicket),
      SECRET,
      NOW,
    );

    expect(resolved).toBeNull();
  });

  it("returns the admin themselves when no impersonation cookie is present", async () => {
    const resolved = await resolveImpersonation(buildDb(), adminSession, null, SECRET, NOW);

    expect(resolved).toEqual(adminSession);
  });

  it("returns the admin themselves when the cookie fails verification", async () => {
    const resolved = await resolveImpersonation(
      buildDb(),
      adminSession,
      "tampered.nonsense",
      SECRET,
      NOW,
    );

    expect(resolved).toEqual(adminSession);
  });

  it("refuses a ticket issued to a different admin", async () => {
    const stolen = createImpersonationTicket(
      { targetUserId: TARGET, impersonatorId: STRANGER },
      NOW,
    ).data!;

    const resolved = await resolveImpersonation(
      buildDb(),
      adminSession,
      cookieFor(stolen),
      SECRET,
      NOW,
    );

    expect(resolved).toEqual(adminSession);
  });

  it("refuses an expired ticket", async () => {
    const afterExpiry = new Date(liveTicket.expiresAt.getTime() + 1);

    const resolved = await resolveImpersonation(
      buildDb(),
      adminSession,
      cookieFor(liveTicket),
      SECRET,
      afterExpiry,
    );

    expect(resolved).toEqual(adminSession);
  });

  it("refuses a ticket held by a non-admin", async () => {
    const ticketFromNonAdmin = createImpersonationTicket(
      { targetUserId: TARGET, impersonatorId: ADMIN },
      NOW,
    ).data!;

    const resolved = await resolveImpersonation(
      buildDb(),
      plainSession,
      cookieFor(ticketFromNonAdmin),
      SECRET,
      NOW,
    );

    expect(resolved).toEqual(plainSession);
  });

  it("falls back to the admin when the target no longer exists", async () => {
    const resolved = await resolveImpersonation(
      buildDb({ targetExists: false }),
      adminSession,
      cookieFor(liveTicket),
      SECRET,
      NOW,
    );

    expect(resolved).toEqual(adminSession);
  });

  it("falls back to the admin rather than throwing when the database is unreachable", async () => {
    const resolved = await resolveImpersonation(
      buildDb({ failReads: true }),
      adminSession,
      cookieFor(liveTicket),
      SECRET,
      NOW,
    );

    expect(resolved).toEqual(adminSession);
  });
});
