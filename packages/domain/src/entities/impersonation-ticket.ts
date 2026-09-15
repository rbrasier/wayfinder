import { domainError } from "../errors/domain-error";
import { err, ok, type Result } from "../result";

// An admin's simulated view of another user (ADR-059). The ticket lives in a
// signed cookie, never in a table: it is not a session in the ADR-035 sense and
// creates no `core_sessions` row, so it counts against nobody's concurrency
// limit.

// Thirty minutes. Long enough to reproduce a reported problem, short enough that
// a forgotten banner stops being a live write-capable session under someone
// else's name within the hour.
export const IMPERSONATION_TTL_MS = 30 * 60 * 1000;

const MS_PER_MINUTE = 60 * 1000;

export interface ImpersonationTicket {
  readonly targetUserId: string;
  readonly impersonatorId: string;
  readonly startedAt: Date;
  readonly expiresAt: Date;
}

export interface NewImpersonationTicket {
  readonly targetUserId: string;
  readonly impersonatorId: string;
}

export const createImpersonationTicket = (
  { targetUserId, impersonatorId }: NewImpersonationTicket,
  now: Date = new Date(),
): Result<ImpersonationTicket> => {
  if (targetUserId.trim().length === 0) {
    return err(domainError("VALIDATION_FAILED", "A user to view as is required."));
  }
  if (targetUserId === impersonatorId) {
    return err(domainError("VALIDATION_FAILED", "You cannot view as yourself."));
  }

  return ok({
    targetUserId,
    impersonatorId,
    startedAt: now,
    expiresAt: new Date(now.getTime() + IMPERSONATION_TTL_MS),
  });
};

export const isImpersonationExpired = (
  ticket: ImpersonationTicket,
  now: Date = new Date(),
): boolean => now.getTime() >= ticket.expiresAt.getTime();

/**
 * Re-issues a ticket with a fresh expiry. `startedAt` is deliberately carried
 * across: the audit trail should show one episode with explicit extensions
 * rather than a start time that drifts every time the admin clicks Extend
 * (ADR-059 §6).
 */
export const extendImpersonation = (
  ticket: ImpersonationTicket,
  now: Date = new Date(),
): Result<ImpersonationTicket> => {
  if (isImpersonationExpired(ticket, now)) {
    return err(domainError("VALIDATION_FAILED", "This simulated session has already ended."));
  }

  return ok({
    ...ticket,
    expiresAt: new Date(now.getTime() + IMPERSONATION_TTL_MS),
  });
};

/**
 * Whole minutes left, floored and never negative. The banner and the server read
 * the same function so they cannot disagree about how long is left.
 */
export const impersonationMinutesRemaining = (
  ticket: ImpersonationTicket,
  now: Date = new Date(),
): number => {
  const remaining = ticket.expiresAt.getTime() - now.getTime();
  if (remaining <= 0) return 0;
  return Math.floor(remaining / MS_PER_MINUTE);
};
