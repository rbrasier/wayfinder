import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SESSION_POLICY, type SessionPolicy } from "@rbrasier/domain";
import { enforceSessionConcurrency } from "../session-concurrency";
import { createSessionRevocationRegistry } from "../session-revocation";
import type { Database } from "../../db/client";

const now = new Date("2026-08-17T12:00:00.000Z");
const minutesAgo = (minutes: number): Date => new Date(now.getTime() - minutes * 60 * 1000);

interface FakeDbOptions {
  readonly sessions?: Array<{ id: string; createdAt: Date }>;
  readonly isAdmin?: boolean;
  readonly failReads?: boolean;
}

// Drizzle's builder is awaited directly for a plain select and via .limit() for a
// single row, so the fake's where() answers to both.
const queryResult = (rows: () => Promise<unknown>) => {
  const build = () => rows();
  return { then: (...args: Parameters<Promise<unknown>["then"]>) => build().then(...args), limit: build };
};

const buildDb = ({ sessions = [], isAdmin = false, failReads = false }: FakeDbOptions) => {
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const del = vi.fn().mockReturnValue({ where: deleteWhere });

  // The enforcer reads the user's admin flag, then their live sessions; the fake
  // answers the two selects in that order.
  const responses = [() => [{ isAdmin }], () => sessions];
  let readIndex = 0;

  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn(() =>
      queryResult(async () => {
        if (failReads) throw new Error("connection lost");
        const response = responses[Math.min(readIndex, responses.length - 1)]!;
        readIndex += 1;
        return response();
      }),
    ),
  };

  const db = {
    select: vi.fn().mockReturnValue(chain),
    delete: del,
  } as unknown as Database;

  return { db, del, deleteWhere };
};

const policyWith = (overrides: Partial<SessionPolicy>): SessionPolicy => ({
  ...DEFAULT_SESSION_POLICY,
  ...overrides,
});

describe("enforceSessionConcurrency", () => {
  it("admits without a query when no limit is configured", async () => {
    const { db } = buildDb({});
    const registry = createSessionRevocationRegistry();

    const admitted = await enforceSessionConcurrency(db, registry, {
      userId: "user-1",
      policy: DEFAULT_SESSION_POLICY,
      now,
    });

    expect(admitted).toBe(true);
    // An unconfigured policy must cost the sign-in path nothing at all.
    expect(db.select).not.toHaveBeenCalled();
  });

  it("admits and evicts the oldest surplus session at the limit", async () => {
    const { db, del } = buildDb({
      sessions: [
        { id: "session-old", createdAt: minutesAgo(300) },
        { id: "session-new", createdAt: minutesAgo(10) },
      ],
    });
    const registry = createSessionRevocationRegistry();

    const admitted = await enforceSessionConcurrency(db, registry, {
      userId: "user-1",
      policy: policyWith({ concurrentSessionLimit: 2 }),
      now,
    });

    expect(admitted).toBe(true);
    expect(del).toHaveBeenCalledOnce();
  });

  it("bumps the cache epoch after evicting so the dropped session stops resolving", async () => {
    const { db } = buildDb({
      sessions: [{ id: "session-old", createdAt: minutesAgo(300) }],
    });
    const registry = createSessionRevocationRegistry();
    const before = registry.epochFor("user-1");

    await enforceSessionConcurrency(db, registry, {
      userId: "user-1",
      policy: policyWith({ concurrentSessionLimit: 1 }),
      now,
    });

    expect(registry.epochFor("user-1")).not.toBe(before);
  });

  it("refuses a non-admin at the limit under the refuse strategy", async () => {
    const { db, del } = buildDb({
      sessions: [{ id: "session-old", createdAt: minutesAgo(300) }],
    });
    const registry = createSessionRevocationRegistry();

    const admitted = await enforceSessionConcurrency(db, registry, {
      userId: "user-1",
      policy: policyWith({ concurrentSessionLimit: 1, evictionStrategy: "refuse" }),
      now,
    });

    expect(admitted).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });

  it("admits an admin under refuse by evicting instead, so no policy strands them", async () => {
    const { db, del } = buildDb({
      sessions: [{ id: "session-old", createdAt: minutesAgo(300) }],
      isAdmin: true,
    });
    const registry = createSessionRevocationRegistry();

    const admitted = await enforceSessionConcurrency(db, registry, {
      userId: "admin-1",
      policy: policyWith({ concurrentSessionLimit: 1, evictionStrategy: "refuse" }),
      now,
    });

    expect(admitted).toBe(true);
    expect(del).toHaveBeenCalledOnce();
  });

  it("admits when the limit cannot be evaluated, rather than blocking sign-in", async () => {
    const { db } = buildDb({ failReads: true });
    const registry = createSessionRevocationRegistry();

    const admitted = await enforceSessionConcurrency(db, registry, {
      userId: "user-1",
      policy: policyWith({ concurrentSessionLimit: 1, evictionStrategy: "refuse" }),
      now,
    });

    // This runs inside the sign-in request. A database blip must not lock the
    // whole instance out of logging in.
    expect(admitted).toBe(true);
  });
});
