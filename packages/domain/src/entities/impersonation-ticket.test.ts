import { describe, expect, it } from "vitest";
import {
  IMPERSONATION_TTL_MS,
  createImpersonationTicket,
  extendImpersonation,
  impersonationMinutesRemaining,
  isImpersonationExpired,
} from "./impersonation-ticket";

const ADMIN = "11111111-1111-1111-1111-111111111111";
const TARGET = "22222222-2222-2222-2222-222222222222";
const NOW = new Date("2026-09-15T10:00:00.000Z");

describe("createImpersonationTicket", () => {
  it("issues a ticket expiring one TTL after now", () => {
    const result = createImpersonationTicket(
      { targetUserId: TARGET, impersonatorId: ADMIN },
      NOW,
    );

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({
      targetUserId: TARGET,
      impersonatorId: ADMIN,
      startedAt: NOW,
      expiresAt: new Date(NOW.getTime() + IMPERSONATION_TTL_MS),
    });
  });

  it("refuses to let an admin impersonate themselves", () => {
    const result = createImpersonationTicket(
      { targetUserId: ADMIN, impersonatorId: ADMIN },
      NOW,
    );

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a blank target", () => {
    const result = createImpersonationTicket(
      { targetUserId: "  ", impersonatorId: ADMIN },
      NOW,
    );

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("isImpersonationExpired", () => {
  const ticket = createImpersonationTicket(
    { targetUserId: TARGET, impersonatorId: ADMIN },
    NOW,
  ).data!;

  it("is live one millisecond before expiry", () => {
    const justBefore = new Date(ticket.expiresAt.getTime() - 1);

    expect(isImpersonationExpired(ticket, justBefore)).toBe(false);
  });

  it("is expired exactly at expiry", () => {
    expect(isImpersonationExpired(ticket, ticket.expiresAt)).toBe(true);
  });

  it("is expired after expiry", () => {
    const later = new Date(ticket.expiresAt.getTime() + 60_000);

    expect(isImpersonationExpired(ticket, later)).toBe(true);
  });
});

describe("extendImpersonation", () => {
  it("moves expiry a full TTL from now while preserving startedAt", () => {
    const ticket = createImpersonationTicket(
      { targetUserId: TARGET, impersonatorId: ADMIN },
      NOW,
    ).data!;
    const tenMinutesLater = new Date(NOW.getTime() + 10 * 60 * 1000);

    const extended = extendImpersonation(ticket, tenMinutesLater);

    expect(extended.data?.startedAt).toEqual(NOW);
    expect(extended.data?.expiresAt).toEqual(
      new Date(tenMinutesLater.getTime() + IMPERSONATION_TTL_MS),
    );
    expect(extended.data?.targetUserId).toBe(TARGET);
    expect(extended.data?.impersonatorId).toBe(ADMIN);
  });

  it("refuses to extend a ticket that has already expired", () => {
    const ticket = createImpersonationTicket(
      { targetUserId: TARGET, impersonatorId: ADMIN },
      NOW,
    ).data!;
    const afterExpiry = new Date(ticket.expiresAt.getTime() + 1);

    const extended = extendImpersonation(ticket, afterExpiry);

    expect(extended.data).toBeUndefined();
    expect(extended.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("impersonationMinutesRemaining", () => {
  const ticket = createImpersonationTicket(
    { targetUserId: TARGET, impersonatorId: ADMIN },
    NOW,
  ).data!;

  it("reports the full TTL at the moment of issue", () => {
    expect(impersonationMinutesRemaining(ticket, NOW)).toBe(30);
  });

  it("floors part-minutes so the banner never over-promises", () => {
    const ninetySecondsLeft = new Date(ticket.expiresAt.getTime() - 90_000);

    expect(impersonationMinutesRemaining(ticket, ninetySecondsLeft)).toBe(1);
  });

  it("reports zero rather than a negative number once expired", () => {
    const wellPast = new Date(ticket.expiresAt.getTime() + 10 * 60 * 1000);

    expect(impersonationMinutesRemaining(ticket, wellPast)).toBe(0);
  });
});
