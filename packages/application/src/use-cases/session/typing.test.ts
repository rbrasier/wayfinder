import { describe, it, expect, beforeEach } from "vitest";
import { domainError, err, ok } from "@rbrasier/domain";
import type {
  ISessionTypingRepository,
  IUserRepository,
  NewSessionTyping,
  Result,
  SessionTyping,
  User,
} from "@rbrasier/domain";
import { HeartbeatTyping } from "./heartbeat-typing";
import { ListTypingUsers } from "./list-typing-users";

class FakeSessionTypingRepository implements ISessionTypingRepository {
  rows: Map<string, SessionTyping> = new Map();

  async heartbeat(input: NewSessionTyping): Promise<Result<SessionTyping>> {
    const key = `${input.sessionId}:${input.userId}`;
    const existing = this.rows.get(key);
    const row: SessionTyping = {
      id: existing?.id ?? `typing-${this.rows.size + 1}`,
      sessionId: input.sessionId,
      userId: input.userId,
      expiresAt: input.expiresAt,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    this.rows.set(key, row);
    return ok(row);
  }

  async listActive(sessionId: string): Promise<Result<SessionTyping[]>> {
    const now = Date.now();
    return ok(
      [...this.rows.values()].filter(
        (row) => row.sessionId === sessionId && row.expiresAt.getTime() > now,
      ),
    );
  }
}

class FakeUserRepository implements IUserRepository {
  users: Map<string, User> = new Map();

  async create(): Promise<Result<User>> { return err(domainError("INFRA_FAILURE", "not used")); }

  async findById(id: string): Promise<Result<User | null>> {
    return ok(this.users.get(id) ?? null);
  }

  async findByEmail(): Promise<Result<User | null>> { return ok(null); }
  async list(): Promise<Result<User[]>> { return ok([...this.users.values()]); }
  async update(): Promise<Result<User>> { return err(domainError("INFRA_FAILURE", "not used")); }
  async delete(): Promise<Result<true>> { return ok(true as const); }
}

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  email: "user@example.com",
  name: "Alex Stone",
  role: null,
  team: null,
  isAdmin: false,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  ...overrides,
});

// ── HeartbeatTyping ───────────────────────────────────────────────────────────

describe("HeartbeatTyping", () => {
  let typing: FakeSessionTypingRepository;
  let useCase: HeartbeatTyping;

  beforeEach(() => {
    typing = new FakeSessionTypingRepository();
    useCase = new HeartbeatTyping(typing);
  });

  it("records a heartbeat with an expiry in the future", async () => {
    const before = Date.now();
    const result = await useCase.execute({ sessionId: "session-1", userId: "user-1" });

    expect(result.error).toBeUndefined();
    expect(result.data?.sessionId).toBe("session-1");
    expect(result.data?.userId).toBe("user-1");
    expect(result.data?.expiresAt.getTime()).toBeGreaterThan(before);
  });

  it("upserts a single row per (session, user) across repeated heartbeats", async () => {
    await useCase.execute({ sessionId: "session-1", userId: "user-1" });
    await useCase.execute({ sessionId: "session-1", userId: "user-1" });
    await useCase.execute({ sessionId: "session-1", userId: "user-1" });

    expect(typing.rows.size).toBe(1);
  });

  it("honours a custom ttl", async () => {
    const before = Date.now();
    const result = await useCase.execute({ sessionId: "session-1", userId: "user-1", ttlSeconds: 30 });

    expect(result.data?.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 30000);
  });

  it("propagates repository errors", async () => {
    typing.heartbeat = async () => err(domainError("INFRA_FAILURE", "DB down"));
    const result = await useCase.execute({ sessionId: "session-1", userId: "user-1" });
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});

// ── ListTypingUsers ───────────────────────────────────────────────────────────

describe("ListTypingUsers", () => {
  let typing: FakeSessionTypingRepository;
  let users: FakeUserRepository;
  let useCase: ListTypingUsers;

  beforeEach(() => {
    typing = new FakeSessionTypingRepository();
    users = new FakeUserRepository();
    users.users.set("user-1", makeUser({ id: "user-1", name: "Alex Stone" }));
    users.users.set("user-2", makeUser({ id: "user-2", name: "Blair Quinn" }));
    useCase = new ListTypingUsers(typing, users);
  });

  const future = () => new Date(Date.now() + 5000);

  it("returns active typers resolved to display names", async () => {
    await typing.heartbeat({ sessionId: "session-1", userId: "user-2", expiresAt: future() });

    const result = await useCase.execute({ sessionId: "session-1" });

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual([{ userId: "user-2", name: "Blair Quinn" }]);
  });

  it("excludes the current user so they never see their own indicator", async () => {
    await typing.heartbeat({ sessionId: "session-1", userId: "user-1", expiresAt: future() });
    await typing.heartbeat({ sessionId: "session-1", userId: "user-2", expiresAt: future() });

    const result = await useCase.execute({ sessionId: "session-1", excludeUserId: "user-1" });

    expect(result.data).toEqual([{ userId: "user-2", name: "Blair Quinn" }]);
  });

  it("ignores expired typing rows", async () => {
    await typing.heartbeat({
      sessionId: "session-1",
      userId: "user-2",
      expiresAt: new Date(Date.now() - 1000),
    });

    const result = await useCase.execute({ sessionId: "session-1" });

    expect(result.data).toEqual([]);
  });

  it("returns a null name when the user cannot be resolved", async () => {
    await typing.heartbeat({ sessionId: "session-1", userId: "ghost", expiresAt: future() });

    const result = await useCase.execute({ sessionId: "session-1" });

    expect(result.data).toEqual([{ userId: "ghost", name: null }]);
  });

  it("propagates repository errors", async () => {
    typing.listActive = async () => err(domainError("INFRA_FAILURE", "DB down"));
    const result = await useCase.execute({ sessionId: "session-1" });
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
