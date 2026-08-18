// Admin-configurable lifecycle rules for authentication sessions (ADR-035).
// Every predicate here is pure so the hot path can apply policy without a query
// and the rules can be tested without a database.

export type SessionEvictionStrategy = "evict_oldest" | "refuse";

export interface SessionPolicy {
  // Minutes of inactivity before a session stops resolving. 0 switches it off.
  idleTimeoutMinutes: number;
  // Maximum session age regardless of activity. 0 switches it off.
  absoluteTimeoutMinutes: number;
  // Sessions one user may hold at once. 0 means no limit.
  concurrentSessionLimit: number;
  evictionStrategy: SessionEvictionStrategy;
}

// Everything off. An install that upgrades into this feature and never opens the
// settings card must behave exactly as it did before it existed.
export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  idleTimeoutMinutes: 0,
  absoluteTimeoutMinutes: 0,
  concurrentSessionLimit: 0,
  evictionStrategy: "evict_oldest",
};

export interface SessionTimestamps {
  readonly createdAt: Date;
  // Null on rows written before last_active_at existed, and on sessions minted
  // by a path that has not stamped it yet.
  readonly lastActiveAt: Date | null;
}

export interface SessionAdmissionCandidate {
  readonly id: string;
  readonly createdAt: Date;
}

export interface SessionAdmissionPlan {
  readonly admit: boolean;
  readonly evictSessionIds: readonly string[];
}

const MINUTE_MS = 60 * 1000;

const elapsedMinutes = (from: Date, now: Date): number => (now.getTime() - from.getTime()) / MINUTE_MS;

export const isSessionTimedOut = (
  policy: SessionPolicy,
  session: SessionTimestamps,
  now: Date,
): boolean => {
  if (policy.absoluteTimeoutMinutes > 0 && elapsedMinutes(session.createdAt, now) > policy.absoluteTimeoutMinutes) {
    return true;
  }
  if (policy.idleTimeoutMinutes === 0) return false;

  // Creation is the earliest activity we can honestly attest to, so a session
  // that has never been stamped is measured from when it was issued.
  const lastActive = session.lastActiveAt ?? session.createdAt;
  return elapsedMinutes(lastActive, now) > policy.idleTimeoutMinutes;
};

/**
 * Decides whether a new session may be created for a user who already holds
 * {@link existingSessions}, and which of those must go to make room.
 *
 * An admin is never refused. A policy that could lock every administrator out of
 * their own instance is the one failure this feature must not introduce, so
 * `refuse` degrades to eviction for admins (ADR-035 §4).
 */
export const planSessionAdmission = (
  policy: SessionPolicy,
  existingSessions: readonly SessionAdmissionCandidate[],
  isAdmin: boolean,
): SessionAdmissionPlan => {
  if (policy.concurrentSessionLimit <= 0) return { admit: true, evictSessionIds: [] };

  const surplus = existingSessions.length + 1 - policy.concurrentSessionLimit;
  if (surplus <= 0) return { admit: true, evictSessionIds: [] };

  if (policy.evictionStrategy === "refuse" && !isAdmin) {
    return { admit: false, evictSessionIds: [] };
  }

  const oldestFirst = [...existingSessions].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  );
  return { admit: true, evictSessionIds: oldestFirst.slice(0, surplus).map((session) => session.id) };
};

const isWholeCount = (value: number): boolean =>
  Number.isInteger(value) && value >= 0;

/**
 * Returns one message per broken bound, empty when the policy is saveable.
 * Bounds only — the guarantee that an admin cannot be stranded lives in
 * {@link planSessionAdmission}, because no arrangement of these numbers can
 * deliver it.
 */
export const sessionPolicyViolations = (policy: SessionPolicy): string[] => {
  const violations: string[] = [];

  if (!isWholeCount(policy.idleTimeoutMinutes)) {
    violations.push("The idle timeout must be a whole number of minutes, or 0 to switch it off.");
  }
  if (!isWholeCount(policy.absoluteTimeoutMinutes)) {
    violations.push("The absolute timeout must be a whole number of minutes, or 0 to switch it off.");
  }
  if (!isWholeCount(policy.concurrentSessionLimit)) {
    violations.push("The concurrent session limit must be a whole number, or 0 for no limit.");
  }

  const bothTimeoutsOn = policy.idleTimeoutMinutes > 0 && policy.absoluteTimeoutMinutes > 0;
  if (bothTimeoutsOn && policy.absoluteTimeoutMinutes < policy.idleTimeoutMinutes) {
    violations.push("The absolute timeout must be at least as long as the idle timeout.");
  }

  return violations;
};

// How stale a last-active stamp may get before resolution rewrites it. Idle
// timeouts are configured in minutes, so a minute of drift costs nothing and it
// keeps the write off all but the first request of each minute.
export const LAST_ACTIVE_REFRESH_INTERVAL_MS = 60 * 1000;

export const shouldRefreshLastActive = (lastActiveAt: Date | null, now: Date): boolean => {
  if (!lastActiveAt) return true;
  return now.getTime() - lastActiveAt.getTime() >= LAST_ACTIVE_REFRESH_INTERVAL_MS;
};
