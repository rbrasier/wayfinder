import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_POLICY,
  LAST_ACTIVE_REFRESH_INTERVAL_MS,
  isSessionTimedOut,
  planSessionAdmission,
  sessionPolicyViolations,
  shouldRefreshLastActive,
} from "./session-policy";

const minutesAgo = (now: Date, minutes: number): Date =>
  new Date(now.getTime() - minutes * 60 * 1000);

const now = new Date("2026-08-17T12:00:00.000Z");

describe("DEFAULT_SESSION_POLICY", () => {
  it("enforces nothing, so an install that never opens the card is unchanged", () => {
    expect(DEFAULT_SESSION_POLICY).toEqual({
      idleTimeoutMinutes: 0,
      absoluteTimeoutMinutes: 0,
      concurrentSessionLimit: 0,
      evictionStrategy: "evict_oldest",
    });
  });
});

describe("isSessionTimedOut", () => {
  it("keeps a session alive when both timeouts are off", () => {
    const session = { createdAt: minutesAgo(now, 60 * 24 * 30), lastActiveAt: minutesAgo(now, 500) };

    expect(isSessionTimedOut(DEFAULT_SESSION_POLICY, session, now)).toBe(false);
  });

  it("rejects a session idle for longer than the idle timeout", () => {
    const policy = { ...DEFAULT_SESSION_POLICY, idleTimeoutMinutes: 30 };
    const session = { createdAt: minutesAgo(now, 40), lastActiveAt: minutesAgo(now, 31) };

    expect(isSessionTimedOut(policy, session, now)).toBe(true);
  });

  it("keeps a session that has been idle for exactly the idle timeout", () => {
    const policy = { ...DEFAULT_SESSION_POLICY, idleTimeoutMinutes: 30 };
    const session = { createdAt: minutesAgo(now, 40), lastActiveAt: minutesAgo(now, 30) };

    // The boundary belongs to the user: 30 minutes idle under a 30-minute
    // timeout has not yet exceeded it.
    expect(isSessionTimedOut(policy, session, now)).toBe(false);
  });

  it("rejects a session older than the absolute timeout however active it is", () => {
    const policy = { ...DEFAULT_SESSION_POLICY, absoluteTimeoutMinutes: 480 };
    const session = { createdAt: minutesAgo(now, 481), lastActiveAt: now };

    expect(isSessionTimedOut(policy, session, now)).toBe(true);
  });

  it("falls back to created_at when the session has never recorded activity", () => {
    const policy = { ...DEFAULT_SESSION_POLICY, idleTimeoutMinutes: 30 };
    const stale = { createdAt: minutesAgo(now, 31), lastActiveAt: null };
    const fresh = { createdAt: minutesAgo(now, 5), lastActiveAt: null };

    // Rows written before last_active_at existed read as null; creation is the
    // last activity we can honestly attest to.
    expect(isSessionTimedOut(policy, stale, now)).toBe(true);
    expect(isSessionTimedOut(policy, fresh, now)).toBe(false);
  });

  it("applies whichever timeout bites first", () => {
    const policy = { idleTimeoutMinutes: 30, absoluteTimeoutMinutes: 60, concurrentSessionLimit: 0, evictionStrategy: "evict_oldest" as const };
    const oldButActive = { createdAt: minutesAgo(now, 61), lastActiveAt: now };
    const youngButIdle = { createdAt: minutesAgo(now, 45), lastActiveAt: minutesAgo(now, 31) };

    expect(isSessionTimedOut(policy, oldButActive, now)).toBe(true);
    expect(isSessionTimedOut(policy, youngButIdle, now)).toBe(true);
  });
});

describe("planSessionAdmission", () => {
  const existing = [
    { id: "session-oldest", createdAt: minutesAgo(now, 300) },
    { id: "session-middle", createdAt: minutesAgo(now, 200) },
    { id: "session-newest", createdAt: minutesAgo(now, 100) },
  ];

  it("admits without evicting when the limit is off", () => {
    const plan = planSessionAdmission(DEFAULT_SESSION_POLICY, existing, false);

    expect(plan).toEqual({ admit: true, evictSessionIds: [] });
  });

  it("admits without evicting while the user is below the limit", () => {
    const policy = { ...DEFAULT_SESSION_POLICY, concurrentSessionLimit: 5 };

    const plan = planSessionAdmission(policy, existing, false);

    expect(plan).toEqual({ admit: true, evictSessionIds: [] });
  });

  it("evicts the oldest surplus so the new session fits inside the limit", () => {
    const policy = { ...DEFAULT_SESSION_POLICY, concurrentSessionLimit: 3 };

    const plan = planSessionAdmission(policy, existing, false);

    // Three existing plus the incoming one is four; one must go, and it is the
    // oldest.
    expect(plan).toEqual({ admit: true, evictSessionIds: ["session-oldest"] });
  });

  it("evicts every surplus session when the limit is lowered below the current count", () => {
    const policy = { ...DEFAULT_SESSION_POLICY, concurrentSessionLimit: 1 };

    const plan = planSessionAdmission(policy, existing, false);

    expect(plan).toEqual({
      admit: true,
      evictSessionIds: ["session-oldest", "session-middle", "session-newest"],
    });
  });

  it("refuses a non-admin at the limit when the strategy is refuse", () => {
    const policy = {
      ...DEFAULT_SESSION_POLICY,
      concurrentSessionLimit: 3,
      evictionStrategy: "refuse" as const,
    };

    const plan = planSessionAdmission(policy, existing, false);

    expect(plan).toEqual({ admit: false, evictSessionIds: [] });
  });

  it("lets an admin in under refuse by evicting instead, so no policy strands an admin", () => {
    const policy = {
      ...DEFAULT_SESSION_POLICY,
      concurrentSessionLimit: 3,
      evictionStrategy: "refuse" as const,
    };

    const plan = planSessionAdmission(policy, existing, true);

    expect(plan).toEqual({ admit: true, evictSessionIds: ["session-oldest"] });
  });

  it("ignores the order the sessions arrive in when choosing what to evict", () => {
    const policy = { ...DEFAULT_SESSION_POLICY, concurrentSessionLimit: 3 };
    const shuffled = [existing[2]!, existing[0]!, existing[1]!];

    const plan = planSessionAdmission(policy, shuffled, false);

    expect(plan).toEqual({ admit: true, evictSessionIds: ["session-oldest"] });
  });
});

describe("sessionPolicyViolations", () => {
  it("accepts a policy with everything switched off", () => {
    expect(sessionPolicyViolations(DEFAULT_SESSION_POLICY)).toEqual([]);
  });

  it("accepts an absolute timeout equal to the idle timeout", () => {
    const policy = {
      ...DEFAULT_SESSION_POLICY,
      idleTimeoutMinutes: 60,
      absoluteTimeoutMinutes: 60,
    };

    expect(sessionPolicyViolations(policy)).toEqual([]);
  });

  it("rejects an absolute timeout shorter than the idle timeout", () => {
    const policy = {
      ...DEFAULT_SESSION_POLICY,
      idleTimeoutMinutes: 120,
      absoluteTimeoutMinutes: 60,
    };

    expect(sessionPolicyViolations(policy)).toEqual([
      "The absolute timeout must be at least as long as the idle timeout.",
    ]);
  });

  it("does not compare against an absolute timeout that is switched off", () => {
    const policy = { ...DEFAULT_SESSION_POLICY, idleTimeoutMinutes: 120 };

    expect(sessionPolicyViolations(policy)).toEqual([]);
  });

  it("rejects negative and non-whole numbers", () => {
    const policy = {
      idleTimeoutMinutes: -1,
      absoluteTimeoutMinutes: 1.5,
      concurrentSessionLimit: -2,
      evictionStrategy: "evict_oldest" as const,
    };

    expect(sessionPolicyViolations(policy)).toEqual([
      "The idle timeout must be a whole number of minutes, or 0 to switch it off.",
      "The absolute timeout must be a whole number of minutes, or 0 to switch it off.",
      "The concurrent session limit must be a whole number, or 0 for no limit.",
    ]);
  });
});

describe("shouldRefreshLastActive", () => {
  it("writes when the session has never recorded activity", () => {
    expect(shouldRefreshLastActive(null, now)).toBe(true);
  });

  it("skips the write while the recorded activity is still recent", () => {
    const lastActiveAt = new Date(now.getTime() - LAST_ACTIVE_REFRESH_INTERVAL_MS + 1000);

    // The hot path must not write on every request; a stamp this fresh already
    // says what the next one would.
    expect(shouldRefreshLastActive(lastActiveAt, now)).toBe(false);
  });

  it("writes once the recorded activity is older than the refresh interval", () => {
    const lastActiveAt = new Date(now.getTime() - LAST_ACTIVE_REFRESH_INTERVAL_MS - 1000);

    expect(shouldRefreshLastActive(lastActiveAt, now)).toBe(true);
  });
});
