import { createHmac, timingSafeEqual } from "node:crypto";
import type { ImpersonationTicket } from "@wayfinder/domain";

// The second cookie of ADR-059's layered session. It carries who is being viewed
// as, and confers no authentication of its own — presented without a valid
// session cookie it resolves as nobody.
export const IMPERSONATION_COOKIE_NAME = "wf.impersonation";

// `<base64url(payload)>.<base64url(hmac)>`. Deliberately the same shape as
// Better Auth's own signed session cookie, so the two read alike when debugging,
// but signed independently — a mistake here must never be able to cost an admin
// their session.
const SEGMENT_SEPARATOR = ".";

interface SerialisedTicket {
  readonly targetUserId: unknown;
  readonly impersonatorId: unknown;
  readonly startedAt: unknown;
  readonly expiresAt: unknown;
}

const signPayload = (payload: string, secret: string): string =>
  createHmac("sha256", secret).update(payload).digest("base64url");

const isValidDate = (value: Date): boolean => !Number.isNaN(value.getTime());

const toTicket = (parsed: SerialisedTicket): ImpersonationTicket | null => {
  const { targetUserId, impersonatorId, startedAt, expiresAt } = parsed;
  if (typeof targetUserId !== "string" || targetUserId.length === 0) return null;
  if (typeof impersonatorId !== "string" || impersonatorId.length === 0) return null;
  if (typeof startedAt !== "string" || typeof expiresAt !== "string") return null;

  const started = new Date(startedAt);
  const expires = new Date(expiresAt);
  if (!isValidDate(started) || !isValidDate(expires)) return null;

  return { targetUserId, impersonatorId, startedAt: started, expiresAt: expires };
};

export const signImpersonationTicket = (
  ticket: ImpersonationTicket,
  secret: string,
): string => {
  const payload = Buffer.from(JSON.stringify(ticket), "utf8").toString("base64url");
  return `${payload}${SEGMENT_SEPARATOR}${signPayload(payload, secret)}`;
};

/**
 * Verifies and decodes an impersonation cookie, or returns null.
 *
 * Fails closed on everything: a bad signature, a truncated or absent segment,
 * unparseable JSON, a payload that is not a ticket, or an unparseable date. It
 * never throws, because every caller sits on the request hot path and a throw
 * there would cost a legitimate admin their own session rather than just their
 * simulation.
 *
 * Expiry is deliberately *not* checked here. This function answers "is this
 * cookie authentic"; whether the ticket is still live is the resolver's call, so
 * that the two reasons for refusing stay separately testable.
 */
export const verifyImpersonationTicket = (
  cookieValue: string,
  secret: string,
): ImpersonationTicket | null => {
  const separatorIndex = cookieValue.lastIndexOf(SEGMENT_SEPARATOR);
  if (separatorIndex <= 0) return null;

  const payload = cookieValue.slice(0, separatorIndex);
  const signature = cookieValue.slice(separatorIndex + 1);
  if (signature.length === 0) return null;

  const expected = signPayload(payload, secret);
  // timingSafeEqual throws on a length mismatch, so the cheap length check comes
  // first — it leaks only the signature's length, which is fixed and public.
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    return toTicket(parsed as SerialisedTicket);
  } catch {
    return null;
  }
};
