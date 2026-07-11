import { describe, expect, it, vi } from "vitest";
import type {
  ClaimTurnResult,
  ISessionRepository,
  IUserRepository,
  Result,
  Session,
  User,
} from "@rbrasier/domain";
import { TurnLease } from "./turn-lease";

const session = { id: "sess-1" } as Session;

const buildLease = (overrides: {
  claim?: Result<ClaimTurnResult>;
  holder?: Result<User | null>;
} = {}) => {
  const claimTurn = vi.fn(async () => overrides.claim ?? ({ data: { claimed: true, session } } as Result<ClaimTurnResult>));
  const heartbeatTurn = vi.fn(async () => ({ data: undefined }) as Result<void>);
  const releaseTurn = vi.fn(async () => ({ data: undefined }) as Result<void>);
  const findById = vi.fn(async () => overrides.holder ?? ({ data: null } as Result<User | null>));

  const sessions = { claimTurn, heartbeatTurn, releaseTurn } as unknown as ISessionRepository;
  const users = { findById } as unknown as IUserRepository;
  return { lease: new TurnLease(sessions, users), claimTurn, heartbeatTurn, releaseTurn, findById };
};

describe("TurnLease.claim", () => {
  it("returns the claimed session when the lease is free", async () => {
    const { lease, claimTurn } = buildLease({ claim: { data: { claimed: true, session } } });

    const result = await lease.claim({
      sessionId: "sess-1",
      turnId: "turn-1",
      userId: "user-1",
      leaseSeconds: 30,
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ claimed: true, session });
    expect(claimTurn).toHaveBeenCalledWith("sess-1", "turn-1", "user-1", 30);
  });

  it("resolves the holder's name when the lease is already held", async () => {
    const { lease, findById } = buildLease({
      claim: { data: { claimed: false, heldBy: "holder-1" } },
      holder: { data: { id: "holder-1", name: "Alex" } as User },
    });

    const result = await lease.claim({
      sessionId: "sess-1",
      turnId: "turn-1",
      userId: "user-1",
      leaseSeconds: 30,
    });

    expect(result.data).toEqual({ claimed: false, heldByName: "Alex" });
    expect(findById).toHaveBeenCalledWith("holder-1");
  });

  it("returns a null holder name when no holder id is recorded", async () => {
    const { lease, findById } = buildLease({
      claim: { data: { claimed: false, heldBy: null } },
    });

    const result = await lease.claim({
      sessionId: "sess-1",
      turnId: "turn-1",
      userId: "user-1",
      leaseSeconds: 30,
    });

    expect(result.data).toEqual({ claimed: false, heldByName: null });
    // No holder id → no lookup.
    expect(findById).not.toHaveBeenCalled();
  });

  it("degrades to a null holder name when the holder lookup fails", async () => {
    const { lease } = buildLease({
      claim: { data: { claimed: false, heldBy: "holder-1" } },
      holder: { error: { code: "INFRA_FAILURE", message: "boom" } },
    });

    const result = await lease.claim({
      sessionId: "sess-1",
      turnId: "turn-1",
      userId: "user-1",
      leaseSeconds: 30,
    });

    expect(result.data).toEqual({ claimed: false, heldByName: null });
  });

  it("propagates a claim repository error", async () => {
    const { lease } = buildLease({ claim: { error: { code: "INFRA_FAILURE", message: "db down" } } });

    const result = await lease.claim({
      sessionId: "sess-1",
      turnId: "turn-1",
      userId: "user-1",
      leaseSeconds: 30,
    });

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});

describe("TurnLease heartbeat/release", () => {
  it("delegates heartbeat to the session repository", async () => {
    const { lease, heartbeatTurn } = buildLease();
    await lease.heartbeat("sess-1", "turn-1");
    expect(heartbeatTurn).toHaveBeenCalledWith("sess-1", "turn-1");
  });

  it("delegates release to the session repository", async () => {
    const { lease, releaseTurn } = buildLease();
    await lease.release("sess-1", "turn-1");
    expect(releaseTurn).toHaveBeenCalledWith("sess-1", "turn-1");
  });
});
